export type Language = {
  languageName: string;
  color: string | null;
  value: number;
  percentage: number;
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

export type MonthlyContribution = {
  month: string; // YYYY-MM format
  contributions: number;
};

export type ContributionStats = {
  longestStreak: number;
  currentStreak: number;
  mostActiveDay: string; // Day of week
  averagePerDay: number;
  averagePerWeek: number;
  averagePerMonth: number;
  monthlyBreakdown: MonthlyContribution[];
};

export type RateLimitInfo = {
  limit: number;
  remaining: number;
  used: number;
  resetAt: string;
};

export type UserProfile = {
  name: string;
  login: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  twitterUsername: string | null;
  websiteUrl: string | null;
  avatarUrl: string;
  createdAt: string;
  followers: number;
  following: number;
};

export type RepoDetails = {
  name: string;
  description: string | null;
  stars: number;
  forks: number;
  isArchived: boolean;
  primaryLanguage: string | null;
  updatedAt: string;
  createdAt: string;
};

export type UserStats = {
  name: string;
  username: string;
  avatarUrl: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  twitterUsername: string | null;
  websiteUrl: string | null;
  createdAt: string;
  repoViews: number;
  linesOfCodeChanged: number;
  linesAdded: number;
  linesDeleted: number;
  commitCount: number;
  totalCommits: number;
  totalPullRequests: number;
  totalPullRequestReviews: number;
  openIssues: number;
  closedIssues: number;
  fetchedAt: number;
  forkCount: number;
  starCount: number;
  starsGiven: number;
  followers: number;
  following: number;
  repositoriesContributedTo: number;
  discussionsStarted: number;
  discussionsAnswered: number;
  totalContributions: number;
  codeByteTotal: number;
  topLanguages: Language[];
  contributionStats: ContributionStats;
  contributionsCollection: ContributionsCollection;
  topRepos: RepoDetails[];
};

export interface GraphQLResponse {
  user: User;
  viewer: Viewer;
  rateLimit?: RateLimitInfo;
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
