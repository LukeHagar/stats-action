import core from "@actions/core";
import { writeFileSync } from "fs";
import { Octokit } from "octokit";
import { throttling } from "@octokit/plugin-throttling";
import {
  ContributionsCollection,
  Language,
  RateLimitInfo,
  ContributionStats,
  MonthlyContribution,
  RepoDetails,
} from "./Types";
import type { GraphQlQueryResponseData } from "@octokit/graphql";

const ThrottledOctokit = Octokit.plugin(throttling);

// Constants
const MAX_RETRY_COUNT = 5;
const BATCH_SIZE = 10;
const RETRY_DELAY_MS = 2000;

/**
 * Log rate limit information from GraphQL response
 */
function logRateLimit(rateLimit: RateLimitInfo | undefined, context: string) {
  if (rateLimit) {
    console.log(
      `[Rate Limit] ${context}: ${rateLimit.remaining}/${rateLimit.limit} remaining (resets at ${rateLimit.resetAt})`
    );
  }
}

/**
 * Process promises in batches to avoid overwhelming the API
 */
export async function processBatched<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Get user profile data with extended fields
 */
export async function getUserData(
  octokit: Octokit,
  username: string
): Promise<GraphQlQueryResponseData> {
  const response = await octokit.graphql<GraphQlQueryResponseData & { rateLimit: RateLimitInfo }>(
    `query userInfo($login: String!) {
      user(login: $login) {
        name
        login
        bio
        company
        location
        email
        twitterUsername
        websiteUrl
        avatarUrl
        createdAt
        followers {
          totalCount
        }
        following {
          totalCount
        }
        pullRequests(first: 1) {
          totalCount
        }
        repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
          totalCount
        }
        openIssues: issues(states: OPEN) {
          totalCount
        }
        closedIssues: issues(states: CLOSED) {
          totalCount
        }
        repositoryDiscussions {
          totalCount
        }
        repositoryDiscussionComments(onlyAnswers: true) {
          totalCount
        }
      }
      rateLimit {
        limit
        remaining
        used
        resetAt
      }
    }`,
    {
      login: username,
    }
  );

  logRateLimit(response.rateLimit, "getUserData");
  return response;
}

/**
 * Get repository data with extended metadata
 */
export async function getRepoData(
  octokit: Octokit,
  username: string
): Promise<GraphQlQueryResponseData> {
  const response = await octokit.graphql.paginate(
    `query repoInfo($login: String!, $cursor: String) {
      user(login: $login) {
        repositories(
          orderBy: {field: STARGAZERS, direction: DESC}
          ownerAffiliations: OWNER
          first: 100
          after: $cursor
        ) {
          totalCount
          nodes {
            name
            description
            isArchived
            createdAt
            updatedAt
            stargazers {
              totalCount
            }
            forkCount
            primaryLanguage {
              name
              color
            }
            languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
              edges {
                size
                node {
                  color
                  name
                }
              }
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
      rateLimit {
        limit
        remaining
        used
        resetAt
      }
    }`,
    {
      login: username,
    }
  );
  logRateLimit((response as { rateLimit?: RateLimitInfo }).rateLimit, "getRepoData");
  return response as GraphQlQueryResponseData;
}

/**
 * Get contribution collection for a date range using proper GraphQL variables
 */
export async function getContributionCollection(
  octokit: Octokit,
  createdAt: string
) {
  const yearCreated = new Date(createdAt);
  const currentYear = new Date();

  const promises = [];
  for (let i = yearCreated.getFullYear(); i <= currentYear.getFullYear(); i++) {
    let startYear = `${i}-01-01T00:00:00.000Z`;
    if (i === yearCreated.getFullYear()) startYear = createdAt;
    let endYear = `${i + 1}-01-01T00:00:00.000Z`;
    if (i === currentYear.getFullYear()) endYear = currentYear.toISOString();

    promises.push(
      octokit
        .graphql<{
          viewer: { contributionsCollection: ContributionsCollection };
          rateLimit: RateLimitInfo;
        }>(
          `query getContributions($from: DateTime!, $to: DateTime!) {
            rateLimit {
              limit
              remaining
              used
              resetAt
            }
            viewer {
              contributionsCollection(from: $from, to: $to) {
                totalCommitContributions
                restrictedContributionsCount
                totalIssueContributions
                totalRepositoryContributions
                totalPullRequestContributions
                totalPullRequestReviewContributions
                contributionCalendar {
                  totalContributions
                  weeks {
                    contributionDays {
                      contributionCount
                      date
                    }
                  }
                }
              }
            }
          }`,
          {
            from: startYear,
            to: endYear,
          }
        )
        .then((response) => {
          logRateLimit(response.rateLimit, `getContributionCollection year ${i}`);
          return response;
        })
        .catch((error) => {
          console.error(`Failed to fetch data for year ${i}: ${error.message}`);
          return null;
        })
    );
  }

  const years = (await Promise.allSettled(promises))
    .filter(
      (result): result is PromiseFulfilledResult<{
        viewer: { contributionsCollection: ContributionsCollection };
        rateLimit: RateLimitInfo;
      } | null> => result.status === "fulfilled" && result.value !== null
    )
    .map((result) => result.value!);

  if (years.length === 0) {
    throw new Error("Failed to fetch data for all years");
  }

  const { contributionsCollection } = years[0].viewer;

  for (const year of years.slice(1)) {
    contributionsCollection.contributionCalendar.totalContributions +=
      year.viewer.contributionsCollection.contributionCalendar.totalContributions;

    contributionsCollection.contributionCalendar.weeks.push(
      ...year.viewer.contributionsCollection.contributionCalendar.weeks
    );

    contributionsCollection.totalCommitContributions +=
      year.viewer.contributionsCollection.totalCommitContributions;

    contributionsCollection.restrictedContributionsCount +=
      year.viewer.contributionsCollection.restrictedContributionsCount;

    contributionsCollection.totalIssueContributions +=
      year.viewer.contributionsCollection.totalIssueContributions;

    contributionsCollection.totalRepositoryContributions +=
      year.viewer.contributionsCollection.totalRepositoryContributions;

    contributionsCollection.totalPullRequestContributions +=
      year.viewer.contributionsCollection.totalPullRequestContributions;

    contributionsCollection.totalPullRequestReviewContributions +=
      year.viewer.contributionsCollection.totalPullRequestReviewContributions;
  }

  return contributionsCollection;
}

/**
 * Get total commits for user
 */
export async function getTotalCommits(octokit: Octokit, username: string) {
  return octokit.rest.search.commits({
    q: `author:${username}`,
  });
}

/**
 * Get stars given by user
 */
export async function getUsersStars(octokit: Octokit, username: string) {
  const response = await octokit.rest.activity.listReposStarredByUser({
    username,
    per_page: 1,
  });
  // The total count is in the Link header or we can make a request with per_page=1
  // and check the last page. For simplicity, we'll count from headers if available.
  const linkHeader = response.headers.link;
  if (linkHeader) {
    const lastPageMatch = linkHeader.match(/page=(\d+)>; rel="last"/);
    if (lastPageMatch) {
      return parseInt(lastPageMatch[1], 10);
    }
  }
  return response.data.length;
}

/**
 * Get contributor stats for a repo with retry limit
 */
export async function getReposContributorsStats(
  octokit: Octokit,
  owner: string,
  repo: string,
  retryCount = 0
): Promise<Awaited<ReturnType<typeof octokit.rest.repos.getContributorsStats>> | undefined> {
  try {
    const response = await octokit.rest.repos.getContributorsStats({
      owner,
      repo,
    });

    if (response.status === 202) {
      if (retryCount >= MAX_RETRY_COUNT) {
        console.warn(
          `Max retries (${MAX_RETRY_COUNT}) reached for ${owner}/${repo}, skipping`
        );
        return undefined;
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return getReposContributorsStats(octokit, owner, repo, retryCount + 1);
    }

    return response;
  } catch (error) {
    console.error(`Error fetching contributor stats for ${owner}/${repo}:`, error);
    return undefined;
  }
}

/**
 * Get view count for a repo
 */
export async function getReposViewCount(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  return octokit.rest.repos.getViews({
    per: "week",
    owner,
    repo,
  });
}

/**
 * Calculate contribution statistics from calendar data
 */
export function calculateContributionStats(
  contributionsCollection: ContributionsCollection
): ContributionStats {
  const allDays: { date: string; count: number }[] = [];
  const monthlyMap = new Map<string, number>();
  const dayOfWeekCounts = new Map<string, number>();

  // Flatten all contribution days
  for (const week of contributionsCollection.contributionCalendar.weeks) {
    for (const day of week.contributionDays) {
      allDays.push({ date: day.date, count: day.contributionCount });

      // Monthly aggregation
      const month = day.date.substring(0, 7); // YYYY-MM
      monthlyMap.set(month, (monthlyMap.get(month) || 0) + day.contributionCount);

      // Day of week aggregation
      const dayOfWeek = new Date(day.date).toLocaleDateString("en-US", {
        weekday: "long",
      });
      dayOfWeekCounts.set(
        dayOfWeek,
        (dayOfWeekCounts.get(dayOfWeek) || 0) + day.contributionCount
      );
    }
  }

  // Sort days by date
  allDays.sort((a, b) => a.date.localeCompare(b.date));

  // Calculate streaks
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  for (let i = allDays.length - 1; i >= 0; i--) {
    const day = allDays[i];
    if (day.count > 0) {
      tempStreak++;
      if (i === allDays.length - 1 && (day.date === today || day.date === yesterday)) {
        currentStreak = tempStreak;
      }
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 0;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  // Recalculate current streak from the end
  currentStreak = 0;
  for (let i = allDays.length - 1; i >= 0; i--) {
    if (allDays[i].count > 0) {
      currentStreak++;
    } else if (allDays[i].date !== today) {
      // Allow today to have 0 if we're still on today
      break;
    }
  }

  // Find most active day
  let mostActiveDay = "Sunday";
  let maxDayCount = 0;
  for (const [day, count] of dayOfWeekCounts) {
    if (count > maxDayCount) {
      maxDayCount = count;
      mostActiveDay = day;
    }
  }

  // Calculate averages
  const totalDays = allDays.length || 1;
  const totalContributions =
    contributionsCollection.contributionCalendar.totalContributions;
  const averagePerDay = totalContributions / totalDays;
  const averagePerWeek = averagePerDay * 7;
  const averagePerMonth = averagePerDay * 30;

  // Monthly breakdown sorted by date
  const monthlyBreakdown: MonthlyContribution[] = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, contributions]) => ({ month, contributions }));

  return {
    longestStreak,
    currentStreak,
    mostActiveDay,
    averagePerDay: Math.round(averagePerDay * 100) / 100,
    averagePerWeek: Math.round(averagePerWeek * 100) / 100,
    averagePerMonth: Math.round(averagePerMonth * 100) / 100,
    monthlyBreakdown,
  };
}

/**
 * Aggregate languages from repos using Map for O(n) performance
 */
export function aggregateLanguages(
  repos: Array<{
    languages: { edges: Array<{ size: number; node: { name: string; color: string } }> };
  }>
): { languages: Language[]; codeByteTotal: number } {
  const languageMap = new Map<string, { color: string | null; value: number }>();
  let codeByteTotal = 0;

  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      const langName = edge.node.name;
      const existing = languageMap.get(langName);
      if (existing) {
        existing.value += edge.size;
      } else {
        languageMap.set(langName, {
          color: edge.node.color,
          value: edge.size,
        });
      }
      codeByteTotal += edge.size;
    }
  }

  // Convert to array, sort by value descending, add percentages
  const languages: Language[] = Array.from(languageMap.entries())
    .map(([languageName, data]) => ({
      languageName,
      color: data.color,
      value: data.value,
      percentage: codeByteTotal > 0
        ? Math.round((data.value / codeByteTotal) * 10000) / 100
        : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return { languages, codeByteTotal };
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Format number to human-readable string
 */
export function formatNumber(num: number): string {
  if (num < 1000) return num.toString();
  if (num < 1000000) return `${(num / 1000).toFixed(1)}K`;
  return `${(num / 1000000).toFixed(1)}M`;
}

/**
 * Main function
 */
async function main() {
  const setup1 = performance.now();
  const token = process.env["GITHUB_TOKEN"];
  if (!token) {
    core.setFailed("GITHUB_TOKEN is not present");
    return;
  }

  const octokit = new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `Request quota exhausted for request ${options.method} ${options.url}`
        );

        if (retryCount < 1) {
          octokit.log.info(`Retrying after ${retryAfter} seconds!`);
          return true;
        }
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit) => {
        octokit.log.warn(
          `SecondaryRateLimit detected for request ${options.method} ${options.url}.`
        );
        octokit.log.info(`Retrying after ${retryAfter} seconds!`);
        return true;
      },
    },
  });

  const fetchedAt = Date.now();
  const setup2 = performance.now();
  console.log(`Setup time: ${(setup2 - setup1).toFixed(2)}ms`);

  // Fetch main data in parallel
  const main1 = performance.now();
  const userDetails = await octokit.rest.users.getAuthenticated();
  const username = userDetails.data.login;

  const [userData, repoData, totalCommits, contributionsCollection, starsGiven] =
    await Promise.all([
      getUserData(octokit, username),
      getRepoData(octokit, username),
      getTotalCommits(octokit, username),
      getContributionCollection(octokit, userDetails.data.created_at),
      getUsersStars(octokit, username),
    ]);

  const main2 = performance.now();
  console.log(`Main data fetch time: ${(main2 - main1).toFixed(2)}ms`);

  // Process repos
  const repos = repoData.user.repositories.nodes;
  let starCount = 0;
  let forkCount = 0;

  interface RepoInfo {
    owner: string;
    name: string;
    isOwner: boolean;
    stars: number;
    forks: number;
    description: string | null;
    isArchived: boolean;
    primaryLanguage: string | null;
    updatedAt: string;
    createdAt: string;
  }

  const repoInfoList: RepoInfo[] = repos.map((repo: {
    name: string;
    nameWithOwner?: string;
    stargazers: { totalCount: number };
    forkCount: number;
    description: string | null;
    isArchived: boolean;
    primaryLanguage: { name: string } | null;
    updatedAt: string;
    createdAt: string;
  }) => {
    let repoOwner: string;
    let repoName: string;

    if (repo.nameWithOwner) {
      [repoOwner, repoName] = repo.nameWithOwner.split("/");
    } else {
      repoOwner = username;
      repoName = repo.name;
    }

    const isOwner = repoOwner === username;
    if (isOwner) {
      starCount += repo.stargazers.totalCount;
      forkCount += repo.forkCount;
    }

    return {
      owner: repoOwner,
      name: repoName,
      isOwner,
      stars: repo.stargazers.totalCount,
      forks: repo.forkCount,
      description: repo.description,
      isArchived: repo.isArchived,
      primaryLanguage: repo.primaryLanguage?.name || null,
      updatedAt: repo.updatedAt,
      createdAt: repo.createdAt,
    };
  });

  // Fetch contributor stats in batches
  const contribStats1 = performance.now();
  const contribStatsResults = await processBatched(
    repoInfoList,
    BATCH_SIZE,
    (repo) => getReposContributorsStats(octokit, repo.owner, repo.name)
  );
  const contribStats2 = performance.now();
  console.log(`Contributor stats fetch time: ${(contribStats2 - contribStats1).toFixed(2)}ms`);

  // Fetch view counts in batches (only for owned repos)
  const viewCount1 = performance.now();
  const ownedRepos = repoInfoList.filter((r) => r.isOwner);
  const viewCountResults = await processBatched(
    ownedRepos,
    BATCH_SIZE,
    (repo) => getReposViewCount(octokit, repo.owner, repo.name)
  );
  const viewCount2 = performance.now();
  console.log(`View count fetch time: ${(viewCount2 - viewCount1).toFixed(2)}ms`);

  // Process contributor stats
  const parseStats1 = performance.now();
  let linesAdded = 0;
  let linesDeleted = 0;
  let commitCount = 0;

  for (const result of contribStatsResults) {
    if (result.status !== "fulfilled" || !result.value) continue;

    const resp = result.value;
    const stats = Array.isArray(resp.data) ? resp.data : [resp.data];
    const userStats = stats.find(
      (contributor) => contributor?.author?.login === username
    );

    if (userStats?.weeks) {
      for (const week of userStats.weeks) {
        if (week.a) linesAdded += week.a;
        if (week.d) linesDeleted += week.d;
        if (week.c) commitCount += week.c;
      }
    }
  }

  const linesOfCodeChanged = linesAdded + linesDeleted;
  const parseStats2 = performance.now();
  console.log(`Parse contributor stats time: ${(parseStats2 - parseStats1).toFixed(2)}ms`);

  // Process view counts
  const parseViews1 = performance.now();
  let repoViews = 0;
  for (const result of viewCountResults) {
    if (result.status === "fulfilled" && result.value) {
      repoViews += result.value.data.count;
    }
  }
  const parseViews2 = performance.now();
  console.log(`Parse views time: ${(parseViews2 - parseViews1).toFixed(2)}ms`);

  // Aggregate languages with O(n) performance
  const parseLang1 = performance.now();
  const { languages: topLanguages, codeByteTotal } = aggregateLanguages(repos);
  const parseLang2 = performance.now();
  console.log(`Parse languages time: ${(parseLang2 - parseLang1).toFixed(2)}ms`);

  // Calculate contribution statistics
  const calcStats1 = performance.now();
  const contributionStats = calculateContributionStats(contributionsCollection);
  const calcStats2 = performance.now();
  console.log(`Calculate contribution stats time: ${(calcStats2 - calcStats1).toFixed(2)}ms`);

  // Build top repos list (top 10 by stars)
  const topRepos: RepoDetails[] = repoInfoList
    .filter((r) => r.isOwner && !r.isArchived)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 10)
    .map((r) => ({
      name: r.name,
      description: r.description,
      stars: r.stars,
      forks: r.forks,
      isArchived: r.isArchived,
      primaryLanguage: r.primaryLanguage,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
    }));

  // Build output
  const tableData = [
    ["Name", userDetails.data.name || ""],
    ["Username", username],
    ["Repository Views", formatNumber(repoViews)],
    ["Lines of Code Changed", formatNumber(linesOfCodeChanged)],
    ["Lines Added", formatNumber(linesAdded)],
    ["Lines Deleted", formatNumber(linesDeleted)],
    ["Commit Count (from stats)", formatNumber(commitCount)],
    ["Total Commits (search)", formatNumber(totalCommits.data.total_count)],
    ["Total Pull Requests", userData.user.pullRequests.totalCount],
    ["Total PR Reviews", contributionsCollection.totalPullRequestReviewContributions],
    ["Code Bytes Total", formatBytes(codeByteTotal)],
    ["Top Languages", topLanguages.slice(0, 5).map((lang) => lang.languageName).join(", ")],
    ["Fork Count", forkCount],
    ["Star Count", starCount],
    ["Stars Given", starsGiven],
    ["Followers", userData.user.followers.totalCount],
    ["Following", userData.user.following.totalCount],
    ["Current Streak", `${contributionStats.currentStreak} days`],
    ["Longest Streak", `${contributionStats.longestStreak} days`],
    ["Most Active Day", contributionStats.mostActiveDay],
    ["Total Contributions", contributionsCollection.contributionCalendar.totalContributions],
    ["Closed Issues", userData.user.closedIssues.totalCount],
    ["Open Issues", userData.user.openIssues.totalCount],
    ["Fetched At", new Date(fetchedAt).toISOString()],
  ];

  const formattedTableData = tableData.map((row) => ({
    Name: row[0],
    Value: row[1],
  }));

  console.table(formattedTableData);

  // Write output file
  const output = {
    name: userDetails.data.name || "",
    avatarUrl: userDetails.data.avatar_url,
    username,
    bio: userData.user.bio || null,
    company: userData.user.company || null,
    location: userData.user.location || null,
    email: userData.user.email || null,
    twitterUsername: userData.user.twitterUsername || null,
    websiteUrl: userData.user.websiteUrl || null,
    createdAt: userDetails.data.created_at,
    repoViews,
    linesOfCodeChanged,
    linesAdded,
    linesDeleted,
    commitCount,
    totalCommits: totalCommits.data.total_count,
    totalPullRequests: userData.user.pullRequests.totalCount,
    totalPullRequestReviews: contributionsCollection.totalPullRequestReviewContributions,
    codeByteTotal,
    topLanguages,
    forkCount,
    starCount,
    starsGiven,
    followers: userData.user.followers.totalCount,
    following: userData.user.following.totalCount,
    repositoriesContributedTo: userData.user.repositoriesContributedTo.totalCount,
    discussionsStarted: userData.user.repositoryDiscussions.totalCount,
    discussionsAnswered: userData.user.repositoryDiscussionComments.totalCount,
    totalContributions: contributionsCollection.contributionCalendar.totalContributions,
    contributionStats,
    contributionsCollection,
    topRepos,
    closedIssues: userData.user.closedIssues.totalCount,
    openIssues: userData.user.openIssues.totalCount,
    fetchedAt,
  };

  writeFileSync("github-user-stats.json", JSON.stringify(output, null, 2));

  // Write GitHub Actions summary
  if (process.env["GITHUB_WORKFLOW"]) {
    await core.summary
      .addHeading("GitHub Stats")
      .addTable([
        [
          { data: "Metric", header: true },
          { data: "Value", header: true },
        ],
        ...tableData.map((row) => [String(row[0]), String(row[1])]),
      ])
      .write();
  }

  console.log(`\nTotal execution time: ${(performance.now() - setup1).toFixed(2)}ms`);
}

// Run main function only when this file is the entry point
const isMainModule = import.meta.main ?? process.argv[1]?.endsWith("index.ts");
if (isMainModule) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    core.setFailed(error instanceof Error ? error.message : String(error));
  });
}
