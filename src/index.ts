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
      }
      viewer {
        openIssues: issues(states: OPEN) {
          totalCount
        }
        closedIssues: issues(states: CLOSED) {
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

export async function getRepoData(octokit: Octokit, username: string) {
  return octokit.graphql.paginate(
    `query repoInfo ($login: String!, $cursor: String) {
    user(login: $login) {
      repositories(
        orderBy: {field: STARGAZERS, direction: DESC}
        ownerAffiliations: OWNER
        isFork: false
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
          `query {
            rateLimit {
              limit
              remaining
              used
              resetAt
            }
        viewer {
          contributionsCollection(from: "${startYear}", to: "${endYear}") {
            totalCommitContributions
            restrictedContributionsCount
            totalIssueContributions
            totalCommitContributions
            totalRepositoryContributions
            totalPullRequestContributions
            totalPullRequestReviewContributions
            popularPullRequestContribution {
              pullRequest {
                id
                title
                repository {
                  name
                  owner {
                    login
                  }
                }
              }
            }
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  contributionCount
                  date
                }
              }
            }
            commitContributionsByRepository {
              contributions {
                totalCount
              }
              repository {
                name
                owner {
                  login
                }
                languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
                  edges {
                    size
                    node {
                      color
                      name
                      id
                    }
                  }
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

  console.debug(years);

  if (years.length === 0) {
    throw new Error("Failed to fetch data for all years");
  }

  const { contributionsCollection } = years[0].viewer;

  for (const year of years.slice(1)) {
    contributionsCollection.commitContributionsByRepository = [
      ...contributionsCollection.commitContributionsByRepository,
      ...year.viewer.contributionsCollection.commitContributionsByRepository,
    ];
    contributionsCollection.contributionCalendar.totalContributions +=
      year.viewer.contributionsCollection.contributionCalendar.totalContributions;
    contributionsCollection.contributionCalendar.weeks = [
      ...contributionsCollection.contributionCalendar.weeks,
      ...year.viewer.contributionsCollection.contributionCalendar.weeks,
    ];
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
  return octokit.rest.repos
    .getContributorsStats({
      owner: username,
      repo,
    })
    .then((res) => {
      if (res.status === 202) {
        setTimeout(() => {
          return octokit.rest.repos.getContributorsStats({
            owner: username,
            repo,
          });
        }, 2000);
      }
      return res;
    })
    .catch((error) => {
      throw new Error(
        `Failed to fetch data for repo ${repo}: ${error.message}`
      );
    });
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
  const token = process.env["GITHUB_TOKEN"];
  if (!token) throw new Error("GITHUB_TOKEN is not present");

  const username = core.getInput("username") || "lukehagar";

  if (!username) throw new Error("Username is not present");

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

  const userDetails = await octokit.rest.users.getByUsername({ username });
  // const accountCreationDate = userDetails.data.created_at;

  const [
    userData,
    repoData,
    totalCommits,
    //  contributionsCollection
  ] = await Promise.all([
    getUserData(octokit, username),
    getRepoData(octokit, username),
    getTotalCommits(octokit, username),
    // getContributionCollection(octokit, accountCreationDate),
  ]);

  let starCount = 0;
  let forkCount = 0;
  for (const repo of repoData.user.repositories.nodes) {
    starCount += repo.stargazers.totalCount;
    forkCount += repo.forkCount;
  }

  const contributorStatsPromises = [];
  const viewCountPromises = [];
  for (const repo of repoData.user.repositories.nodes) {
    contributorStatsPromises.push(
      getReposContributorsStats(octokit, username, repo.name)
    );
    viewCountPromises.push(getReposViewCount(octokit, username, repo.name));
  }

  const contributorStats = (await Promise.all(contributorStatsPromises))
    .filter((entry) => entry !== null || entry !== undefined)
    .map((entry) => {
      return (Array.isArray(entry.data) ? entry.data : [entry.data])
        .filter(
          (contributor) => contributor.author?.login === userDetails.data.login
        )
        .map((contributor) => contributor.weeks);
    });

  let linesOfCodeChanged = 0;

  for (const repo of contributorStats) {
    for (const week of repo) {
      for (const day of week) {
        linesOfCodeChanged += (day.a || 0) + (day.d || 0) + (day.c || 0);
      }
    }
  }

  const viewCounts = await Promise.all(viewCountPromises);

  let repoViews = 0;
  for (const viewCount of viewCounts) {
    repoViews += viewCount.data.count;
  }

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

  // const allDays = contributionsCollection.contributionCalendar.weeks
  //   .map((w) => w.contributionDays)
  //   .flat(1);

  writeFileSync(
    "github-user-stats.json",
    JSON.stringify(
      {
        name: userDetails.data.name || "",
        username,
        repoViews,
        linesOfCodeChanged,
        totalCommits: totalCommits.data.total_count,
        totalPullRequests: userData.user.pullRequests.totalCount,
        codeByteTotal,
        topLanguages,
        forkCount,
        starCount,
        // totalContributions:
        //   contributionsCollection.contributionCalendar.totalContributions,
        closedIssues: userData.viewer.closedIssues.totalCount,
        openIssues: userData.viewer.openIssues.totalCount,
        fetchedAt,
        // contributionData: allDays,
      },
      null,
      4
    )
  );
} catch (error) {
  core.setFailed(error as string);
}
