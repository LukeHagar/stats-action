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

export type UserStats = {
  name: string;
  username: string;
  repoViews: number;
  linesOfCodeChanged: number;
  totalCommits: number;
  totalPullRequests: number;
  openIssues: number;
  closedIssues: number;
  fetchedAt: number;
  forkCount: number;
  starCount: number;
  totalContributions: number;
  codeByteTotal: number;
  topLanguages: Array<{
    languageName: string;
    color: string | null;
    value: number;
  }>;
  contributionData: Array<{ contributionCount: number; date: string }>;
};

export type Language = {
  languageName: string;
  color: string | null;
  value: number;
};

export type ContributionData = {
  contributionCount: number;
  date: string;
};

export type ContributionsCollection = {
  totalCommitContributions: number;
  restrictedContributionsCount: number;
  totalIssueContributions: number;
  totalRepositoryContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  contributionCalendar: {
    totalContributions: number;
    weeks: {
      contributionDays: {
        contributionCount: number;
        date: string;
      }[];
    }[];
  };
};

export interface GraphQLResponse {
  user: User;
  viewer: Viewer;
}

export interface User {
  name: string;
  login: string;
  repositories: Repositories;
  pullRequests: PullRequests;
}

export interface Repositories {
  totalCount: number;
  nodes: Node[];
}

export interface Node {
  stargazers: Stargazers;
  name: string;
  languages: Languages;
  forkCount: number;
}

export interface Stargazers {
  totalCount: number;
}

export interface Languages {
  edges: Edge[];
}

export interface Edge {
  size: number;
  node: Node2;
}

export interface Node2 {
  color: string;
  name: string;
}

export interface PullRequests {
  totalCount: number;
}

export interface Viewer {
  openIssues: OpenIssues;
  closedIssues: ClosedIssues;
}

export interface OpenIssues {
  totalCount: number;
}

export interface ClosedIssues {
  totalCount: number;
}
