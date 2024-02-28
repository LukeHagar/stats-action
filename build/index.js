import core from "@actions/core";
import { Octokit } from "octokit";
import { config } from "dotenv";
import { getContributionCollection, getGraphQLData, getReposContributorsStats, getReposViewCount, getTotalCommits, } from "./octokit";
import { writeFileSync } from "fs";
config();
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
const NOT_LANGUAGES_OBJ = Object.fromEntries(NOT_LANGUAGES.map((l) => [l, true]));
try {
    const token = process.env["GITHUB_TOKEN"];
    if (!token)
        throw new Error("GITHUB_TOKEN is not present");
    const octokit = new Octokit({ auth: token });
    const fetchedAt = Date.now();
    const userDetails = await octokit.rest.users.getAuthenticated();
    const username = userDetails.data.login;
    const accountCreationDate = userDetails.data.created_at;
    const [graphQLData, totalCommits, contributionsCollection] = await Promise.all([
        getGraphQLData(octokit, username),
        getTotalCommits(octokit, username),
        getContributionCollection(octokit, accountCreationDate),
    ]);
    console.log(userDetails);
    console.log(graphQLData);
    console.log(totalCommits);
    console.log(contributionsCollection);
    let starCount = 0;
    let forkCount = 0;
    for (const repo of graphQLData.user.repositories.nodes) {
        starCount += repo.stargazers.totalCount;
        forkCount += repo.forkCount;
    }
    const contributorStatsPromises = [];
    const viewCountPromises = [];
    for (const repo of graphQLData.user.repositories.nodes) {
        contributorStatsPromises.push(getReposContributorsStats(octokit, username, repo.name));
        viewCountPromises.push(getReposViewCount(octokit, username, repo.name));
    }
    const contributorStats = (await Promise.all(contributorStatsPromises))
        .filter((entry) => entry !== null || entry !== undefined)
        .map((entry) => {
        return (Array.isArray(entry.data) ? entry.data : [entry.data])
            .filter((contributor) => contributor.author?.login === userDetails.data.login)
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
    const topLanguages = [];
    let codeByteTotal = 0;
    for (const node of graphQLData.user.repositories.nodes) {
        for (const edge of node.languages.edges) {
            if (NOT_LANGUAGES_OBJ[edge.node.name.toLowerCase()]) {
                continue;
            }
            const existingLanguage = topLanguages.find((l) => l.languageName === edge.node.name);
            if (existingLanguage) {
                existingLanguage.value += edge.size;
                codeByteTotal += edge.size;
            }
            else {
                topLanguages.push({
                    languageName: edge.node.name,
                    color: edge.node.color,
                    value: edge.size,
                });
                codeByteTotal += edge.size;
            }
        }
    }
    const allDays = contributionsCollection.contributionCalendar.weeks
        .map((w) => w.contributionDays)
        .flat(1);
    writeFileSync("github-user-stats.json", JSON.stringify({
        name: userDetails.data.name || "",
        username,
        repoViews,
        linesOfCodeChanged,
        totalCommits: totalCommits.data.total_count,
        totalPullRequests: graphQLData.user.pullRequests.totalCount,
        codeByteTotal,
        topLanguages,
        forkCount,
        starCount,
        totalContributions: contributionsCollection.contributionCalendar.totalContributions,
        closedIssues: graphQLData.viewer.closedIssues.totalCount,
        openIssues: graphQLData.viewer.openIssues.totalCount,
        fetchedAt,
        contributionData: allDays,
    }, null, 4));
}
catch (error) {
    core.setFailed(error);
}
//# sourceMappingURL=index.js.map