import { Octokit } from "octokit";
import {ContributionsCollection, } from './Types';

export async function getGraphQLData(octokit: Octokit, username: string){
    return octokit.graphql.paginate(`query userInfo($login: String!, $cursor: String) {
      user(login: $login) {
        name
        login
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
    }`, {
    login: username,
  });
}

export async function getContributionCollection(octokit: Octokit, year: string) {

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
					Promise<{viewer: {contributionsCollection: ContributionsCollection}}>
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
					throw new Error(
						`Failed to fetch data for year ${i}: ${error.message}`
					);
				})
		);
	}

	console.log(promises);

	const years = (await Promise.all(promises)).filter(Boolean) as {
		viewer: {contributionsCollection: ContributionsCollection};
	}[];

	console.debug(years);

	if (years.length === 0) {
		throw new Error('Failed to fetch data for all years');
	}

	const {contributionsCollection} = years[0].viewer;

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

export async function getUsersStars(octokit:Octokit, username: string) {
	return octokit.rest.activity.listReposStarredByUser({
		username,
	});
}

export async function getReposContributorsStats(
    octokit: Octokit,
	username: string,
	repo: string,
	
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
	repo: string,
	
) {
	return octokit.rest.repos.getViews({
		per: 'week',
		owner: username,
		repo,
	});
}
