import core from "@actions/core";
import { config } from "dotenv";
import { writeFileSync } from "fs";
import { Octokit } from "octokit";
import { throttling } from "@octokit/plugin-throttling";
import { ContributionsCollection, Language } from "./Types";
import type { GraphQlQueryResponseData } from "@octokit/graphql";
config();

const ThrottledOctokit = Octokit.plugin(throttling);

export async function getUserData(
  octokit: Octokit,
  username: string
): Promise<GraphQlQueryResponseData> {
  return octokit.graphql(
    `query userInfo($login: String!) {
      user(login: $login) {
        name
        login
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
        followers {
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
}

export async function getRepoData(
  octokit: Octokit,
  username: string
): Promise<GraphQlQueryResponseData> {
  return octokit.graphql.paginate(
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
            stargazers {
              totalCount
            }
            forkCount
            name
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
    }`,
    {
      login: username,
    }
  );
}

export async function getContributionCollection(
  octokit: Octokit,
  year: string
) {
  const yearCreated = new Date(year);
  const currentYear = new Date();

  const promises = [];
  for (let i = yearCreated.getFullYear(); i <= currentYear.getFullYear(); i++) {
    let startYear = `${i}-01-01T00:00:00.000Z`;
    if (i === yearCreated.getFullYear()) startYear = year;
    let endYear = `${i + 1}-01-01T00:00:00.000Z`;
    if (i === currentYear.getFullYear()) endYear = currentYear.toISOString();
    promises.push(
      octokit
        .graphql<
          Promise<{
            viewer: { contributionsCollection: ContributionsCollection };
          }>
        >(
          `{
            rateLimit {
              limit
              remaining
              used
              resetAt
            }
            viewer {
              contributionsCollection(
                from: "${startYear}"
                to: "${endYear}"
              ) {
                totalCommitContributions
                restrictedContributionsCount
                totalIssueContributions
                totalCommitContributions
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
          }
    `
        )
        .catch((error) => {
          console.error(`Failed to fetch data for year ${i}: ${error.message}`);
        })
    );
  }

  const years = (await Promise.all(promises)).filter(Boolean) as {
    viewer: { contributionsCollection: ContributionsCollection };
  }[];

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

export async function getTotalCommits(octokit: Octokit, username: string) {
  return octokit.rest.search.commits({
    q: `author:${username}`,
  });
}

export async function getUsersStars(octokit: Octokit, username: string) {
  return octokit.rest.activity.listReposStarredByUser({
    username,
  });
}

export async function getReposContributorsStats(
  octokit: Octokit,
  username: string,
  repo: string
) {
  try {
    const response = await octokit.rest.repos.getContributorsStats({
      owner: username,
      repo,
    });

    if (response.status === 202) {
      // Retry after the specified delay
      await new Promise((resolve) => setTimeout(resolve, 2 * 1000));

      // Retry the request
      return getReposContributorsStats(octokit, username, repo);
    } else {
      return response;
    }
  } catch (error) {
    console.error(error);
    return undefined;
  }
}

export async function getReposViewCount(
  octokit: Octokit,
  username: string,
  repo: string
) {
  return octokit.rest.repos.getViews({
    per: "week",
    owner: username,
    repo,
  });
}

export const NOT_LANGUAGES = [
  "html",
  "markdown",
  "dockerfile",
  "roff",
  "rich text format",
  "powershell",
  "css",
  "php",
];

const NOT_LANGUAGES_OBJ = Object.fromEntries(
  NOT_LANGUAGES.map((l) => [l, true])
);

try {
  const setup1 = performance.now();
  const token = process.env["GITHUB_TOKEN"];
  if (!token) core.error("GITHUB_TOKEN is not present");

  const octokit = new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `Request quota exhausted for request ${options.method} ${options.url}`
        );

        if (retryCount < 1) {
          // only retries once
          octokit.log.info(`Retrying after ${retryAfter} seconds!`);
          return true;
        }
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit) => {
        // does not retry, only logs a warning
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

  console.log(`Setup time: ${setup2 - setup1}ms`);

  const main1 = performance.now();

  const userDetails = await octokit.rest.users.getAuthenticated();

  const username = userDetails.data.login;
  const [userData, repoData, totalCommits, contributionsCollection] =
    await Promise.all([
      getUserData(octokit, username),
      getRepoData(octokit, username),
      getTotalCommits(octokit, username),
      getContributionCollection(octokit, userDetails.data.created_at),
    ]);

  const main2 = performance.now();

  console.log(`Main time: ${main2 - main1}ms`);

  const viewCountPromises = [];
  let starCount = 0;
  let forkCount = 0;
  let contribStatsPromises = [];
  let contributorStats = [];

  const repos = repoData.user.repositories.nodes;

  const promisesCreate1 = performance.now();
  const promisesResolve1 = performance.now();

  for (const repo of repos) {
    let repoOwner, repoName;

    if (repo.nameWithOwner) {
      [repoOwner, repoName] = repo.nameWithOwner.split("/");
    } else {
      repoOwner = username;
      repoName = repo.name;
    }

    contribStatsPromises.push(
      getReposContributorsStats(octokit, repoOwner, repoName)
    );

    if (repoOwner === username) {
      viewCountPromises.push(getReposViewCount(octokit, username, repoName));
      starCount += repo.stargazers.totalCount;
      forkCount += repo.forkCount;
    }
  }

  const promisesCreate2 = performance.now();

  console.log(`Promises create time: ${promisesCreate2 - promisesCreate1}ms`);

  const repoContribStatsResps = await Promise.all(contribStatsPromises);

  const promisesResolve2 = performance.now();

  console.log(
    `Promises resolve time: ${promisesResolve2 - promisesResolve1}ms`
  );

  const parseRepoPromises1 = performance.now();

  for (const resp of repoContribStatsResps) {
    if (!resp) {
      continue;
    }

    let stats;

    if (!Array.isArray(resp.data)) {
      console.log(resp);
      stats = [resp.data];
    } else {
      stats = resp.data;
    }

    const repoContribStats = stats.find(
      (contributor) => contributor?.author?.login === username
    );

    if (repoContribStats?.weeks)
      contributorStats.push(...repoContribStats.weeks);
  }

  const parseRepoPromises2 = performance.now();

  console.log(
    `Parse repo promises time: ${parseRepoPromises2 - parseRepoPromises1}ms`
  );

  const parseLines1 = performance.now();

  let linesOfCodeChanged = 0;
  let addedLines = 0;
  let deletedLines = 0;
  let changedLines = 0;

  for (const week of contributorStats) {
    if (week.a) {
      linesOfCodeChanged += week.a;
      addedLines += week.a;
    }
    if (week.d) {
      linesOfCodeChanged += week.d;
      deletedLines += week.d;
    }
    if (week.c) {
      linesOfCodeChanged += week.c;
      changedLines += week.c;
    }
  }

  const parseLines2 = performance.now();

  console.log(`Parse lines time: ${parseLines2 - parseLines1}ms`);

  const parseViews1 = performance.now();

  const viewCounts = await Promise.all(viewCountPromises);

  let repoViews = 0;
  for (const viewCount of viewCounts) {
    repoViews += viewCount.data.count;
  }

  const parseViews2 = performance.now();

  console.log(`Parse views time: ${parseViews2 - parseViews1}ms`);

  const parseLang1 = performance.now();

  const topLanguages: Language[] = [];
  let codeByteTotal = 0;

  for (const node of repoData.user.repositories.nodes) {
    for (const edge of node.languages.edges) {
      if (NOT_LANGUAGES_OBJ[edge.node.name.toLowerCase()]) {
        continue;
      }

      const existingLanguage = topLanguages.find(
        (l) => l.languageName === edge.node.name
      );

      if (existingLanguage) {
        existingLanguage.value += edge.size;
        codeByteTotal += edge.size;
      } else {
        topLanguages.push({
          languageName: edge.node.name,
          color: edge.node.color,
          value: edge.size,
        });
        codeByteTotal += edge.size;
      }
    }
  }

  const parseLang2 = performance.now();

  console.log(`Parse languages time: ${parseLang2 - parseLang1}ms`);

  const tableData = [
    ["Name", userDetails.data.name || ""],
    ["Username", username],
    ["Repository Views", repoViews],
    ["Lines of Code Changed", linesOfCodeChanged],
    ["Lines Added", addedLines],
    ["Lines Deleted", deletedLines],
    ["Lines Changed", changedLines],
    ["Total Commits", totalCommits.data.total_count],
    ["Total Pull Requests", userData.user.pullRequests.totalCount],
    ["Code Byte Total", codeByteTotal],
    ["Top Languages", topLanguages.map((lang) => lang.languageName).join(", ")],
    ["Fork Count", forkCount],
    ["Star Count", starCount],
    [
      "Total Contributions",
      contributionsCollection.contributionCalendar.totalContributions,
    ],
    ["Closed Issues", userData.user.closedIssues.totalCount],
    ["Open Issues", userData.user.openIssues.totalCount],
    ["Fetched At", fetchedAt],
  ];

  const formattedTableData = tableData.map((row) => {
    return { Name: row[0], Value: row[1] };
  });

  console.table(formattedTableData);

  writeFileSync(
    "github-user-stats.json",
    JSON.stringify(
      {
        name: userDetails.data.name || "",
        avatarUrl: userDetails.data.avatar_url,
        username,
        repoViews,
        linesOfCodeChanged,
        linesAdded: addedLines,
        linesDeleted: deletedLines,
        linesChanged: changedLines,
        totalCommits: totalCommits.data.total_count,
        totalPullRequests: userData.user.pullRequests.totalCount,
        codeByteTotal,
        topLanguages,
        forkCount,
        starCount,
        totalContributions:
          contributionsCollection.contributionCalendar.totalContributions,
        contributionsCollection,
        closedIssues: userData.user.closedIssues.totalCount,
        openIssues: userData.user.openIssues.totalCount,
        fetchedAt,
      },
      null,
      4
    )
  );

  if (process.env["GITHUB_WORKFLOW"])
    await core.summary
      .addHeading("Test Results")
      .addTable([
        [
          { data: "Name", header: true },
          { data: "Value", header: true },
        ],
        ...tableData.map((row) => [String(row[0]), String(row[1])]),
      ])
      .write();
} catch (error) {
  core.setFailed(error as string);
}
