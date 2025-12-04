import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatNumber,
  aggregateLanguages,
  calculateContributionStats,
  calculateComputedStats,
} from "./index";
import type { ContributionsCollection, Language, ContributionStats } from "./Types";

describe("formatBytes", () => {
  test("formats bytes correctly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  test("formats kilobytes correctly", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10240)).toBe("10.0 KB");
  });

  test("formats megabytes correctly", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(100 * 1024 * 1024)).toBe("100.0 MB");
  });

  test("formats gigabytes correctly", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
  });
});

describe("formatNumber", () => {
  test("formats small numbers as-is", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1)).toBe("1");
    expect(formatNumber(999)).toBe("999");
  });

  test("formats thousands with K suffix", () => {
    expect(formatNumber(1000)).toBe("1.0K");
    expect(formatNumber(1500)).toBe("1.5K");
    expect(formatNumber(10000)).toBe("10.0K");
    expect(formatNumber(999999)).toBe("1000.0K");
  });

  test("formats millions with M suffix", () => {
    expect(formatNumber(1000000)).toBe("1.0M");
    expect(formatNumber(1500000)).toBe("1.5M");
    expect(formatNumber(10000000)).toBe("10.0M");
  });
});

describe("aggregateLanguages", () => {
  test("aggregates languages from multiple repos", () => {
    const repos = [
      {
        languages: {
          edges: [
            { size: 1000, node: { name: "TypeScript", color: "#3178c6" } },
            { size: 500, node: { name: "JavaScript", color: "#f1e05a" } },
          ],
        },
      },
      {
        languages: {
          edges: [
            { size: 2000, node: { name: "TypeScript", color: "#3178c6" } },
            { size: 300, node: { name: "Python", color: "#3572A5" } },
          ],
        },
      },
    ];

    const result = aggregateLanguages(repos);

    expect(result.codeByteTotal).toBe(3800);
    expect(result.languages).toHaveLength(3);

    // Should be sorted by value descending
    expect(result.languages[0].languageName).toBe("TypeScript");
    expect(result.languages[0].value).toBe(3000);
    expect(result.languages[0].percentage).toBeCloseTo(78.95, 1);

    expect(result.languages[1].languageName).toBe("JavaScript");
    expect(result.languages[1].value).toBe(500);

    expect(result.languages[2].languageName).toBe("Python");
    expect(result.languages[2].value).toBe(300);
  });

  test("handles empty repos", () => {
    const repos: Array<{ languages: { edges: Array<{ size: number; node: { name: string; color: string } }> } }> = [];
    const result = aggregateLanguages(repos);

    expect(result.codeByteTotal).toBe(0);
    expect(result.languages).toHaveLength(0);
  });

  test("handles repos with no languages", () => {
    const repos = [{ languages: { edges: [] } }];
    const result = aggregateLanguages(repos);

    expect(result.codeByteTotal).toBe(0);
    expect(result.languages).toHaveLength(0);
  });

  test("preserves language colors", () => {
    const repos = [
      {
        languages: {
          edges: [{ size: 1000, node: { name: "Rust", color: "#dea584" } }],
        },
      },
    ];

    const result = aggregateLanguages(repos);
    expect(result.languages[0].color).toBe("#dea584");
  });
});

describe("calculateContributionStats", () => {
  const createContributionsCollection = (
    days: Array<{ date: string; contributionCount: number }>
  ): ContributionsCollection => ({
    totalCommitContributions: 0,
    restrictedContributionsCount: 0,
    totalIssueContributions: 0,
    totalRepositoryContributions: 0,
    totalPullRequestContributions: 0,
    totalPullRequestReviewContributions: 0,
    contributionCalendar: {
      totalContributions: days.reduce((sum, d) => sum + d.contributionCount, 0),
      weeks: [{ contributionDays: days }],
    },
  });

  test("calculates longest streak correctly", () => {
    const collection = createContributionsCollection([
      { date: "2024-01-01", contributionCount: 1 },
      { date: "2024-01-02", contributionCount: 2 },
      { date: "2024-01-03", contributionCount: 0 },
      { date: "2024-01-04", contributionCount: 1 },
      { date: "2024-01-05", contributionCount: 1 },
      { date: "2024-01-06", contributionCount: 1 },
    ]);

    const stats = calculateContributionStats(collection);
    expect(stats.longestStreak).toBe(3);
  });

  test("calculates averages correctly", () => {
    const collection = createContributionsCollection([
      { date: "2024-01-01", contributionCount: 10 },
      { date: "2024-01-02", contributionCount: 20 },
      { date: "2024-01-03", contributionCount: 30 },
      { date: "2024-01-04", contributionCount: 40 },
    ]);

    const stats = calculateContributionStats(collection);
    expect(stats.averagePerDay).toBe(25);
    expect(stats.averagePerWeek).toBe(175);
  });

  test("calculates monthly breakdown correctly", () => {
    const collection = createContributionsCollection([
      { date: "2024-01-15", contributionCount: 5 },
      { date: "2024-01-20", contributionCount: 10 },
      { date: "2024-02-10", contributionCount: 15 },
    ]);

    const stats = calculateContributionStats(collection);
    expect(stats.monthlyBreakdown).toHaveLength(2);
    expect(stats.monthlyBreakdown[0]).toEqual({ month: "2024-01", contributions: 15 });
    expect(stats.monthlyBreakdown[1]).toEqual({ month: "2024-02", contributions: 15 });
  });

  test("identifies most active day of week", () => {
    // Create contributions heavily weighted toward Monday
    const collection = createContributionsCollection([
      { date: "2024-01-01", contributionCount: 100 }, // Monday
      { date: "2024-01-02", contributionCount: 1 },   // Tuesday
      { date: "2024-01-08", contributionCount: 100 }, // Monday
      { date: "2024-01-09", contributionCount: 1 },   // Tuesday
    ]);

    const stats = calculateContributionStats(collection);
    expect(stats.mostActiveDay).toBe("Monday");
  });

  test("handles empty contribution data", () => {
    const collection = createContributionsCollection([]);
    const stats = calculateContributionStats(collection);

    expect(stats.longestStreak).toBe(0);
    expect(stats.currentStreak).toBe(0);
    expect(stats.averagePerDay).toBe(0);
    expect(stats.monthlyBreakdown).toHaveLength(0);
  });
});

describe("calculateComputedStats", () => {
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;

  const createRepoInfo = (overrides: Partial<{
    stars: number;
    forks: number;
    isArchived: boolean;
    isFork: boolean;
    isPrivate: boolean;
    topics: string[];
    updatedAt: string;
    createdAt: string;
    languages: { edges: Array<{ size: number; node: { name: string; color: string } }> };
  }> = {}) => ({
    stars: 0,
    forks: 0,
    isArchived: false,
    isFork: false,
    isPrivate: false,
    topics: [],
    updatedAt: `${currentYear}-06-01T00:00:00Z`,
    createdAt: `${lastYear}-01-01T00:00:00Z`,
    languages: { edges: [] },
    ...overrides,
  });

  const createContributionStats = (monthlyBreakdown: Array<{ month: string; contributions: number }>): ContributionStats => ({
    longestStreak: 0,
    currentStreak: 0,
    mostActiveDay: "Monday",
    averagePerDay: 0,
    averagePerWeek: 0,
    averagePerMonth: 0,
    monthlyBreakdown,
  });

  test("calculates repo statistics correctly", () => {
    const repos = [
      createRepoInfo({ stars: 10, isPrivate: false }),
      createRepoInfo({ stars: 5, isPrivate: true }),
      createRepoInfo({ isArchived: true }),
      createRepoInfo({ isFork: true }),
      createRepoInfo({ updatedAt: `${currentYear}-01-15T00:00:00Z` }),
      createRepoInfo({ createdAt: `${currentYear}-03-01T00:00:00Z`, updatedAt: `${currentYear}-03-01T00:00:00Z` }),
    ];

    const stats = calculateComputedStats(repos, [], createContributionStats([]));

    expect(stats.totalRepos).toBe(6);
    expect(stats.publicRepos).toBe(5);
    expect(stats.privateRepos).toBe(1);
    expect(stats.archivedRepos).toBe(1);
    expect(stats.forkedRepos).toBe(1);
    expect(stats.originalRepos).toBe(5);
    expect(stats.reposWithStars).toBe(2);
    expect(stats.reposCreatedThisYear).toBe(1);
    expect(stats.averageStarsPerRepo).toBe(2.5); // 15 stars / 6 repos
  });

  test("calculates language statistics correctly", () => {
    const topLanguages: Language[] = [
      { languageName: "TypeScript", color: "#3178c6", value: 1000, percentage: 50 },
      { languageName: "JavaScript", color: "#f1e05a", value: 500, percentage: 25 },
      { languageName: "Python", color: "#3572A5", value: 500, percentage: 25 },
    ];

    const stats = calculateComputedStats([], topLanguages, createContributionStats([]));

    expect(stats.languageCount).toBe(3);
    expect(stats.primaryLanguage).toBe("TypeScript");
  });

  test("calculates year over year growth correctly", () => {
    const contributionStats = createContributionStats([
      { month: `${lastYear}-01`, contributions: 50 },
      { month: `${lastYear}-02`, contributions: 50 },
      { month: `${currentYear}-01`, contributions: 75 },
      { month: `${currentYear}-02`, contributions: 75 },
    ]);

    const stats = calculateComputedStats([], [], contributionStats);

    expect(stats.contributionsLastYear).toBe(100);
    expect(stats.contributionsThisYear).toBe(150);
    expect(stats.yearOverYearGrowth).toBe(50); // 50% growth
  });

  test("identifies most productive month", () => {
    const contributionStats = createContributionStats([
      { month: `${currentYear}-01`, contributions: 50 },
      { month: `${currentYear}-02`, contributions: 150 },
      { month: `${currentYear}-03`, contributions: 75 },
    ]);

    const stats = calculateComputedStats([], [], contributionStats);

    expect(stats.mostProductiveMonth).toEqual({
      month: `${currentYear}-02`,
      contributions: 150,
    });
  });

  test("handles empty data gracefully", () => {
    const stats = calculateComputedStats([], [], createContributionStats([]));

    expect(stats.totalRepos).toBe(0);
    expect(stats.languageCount).toBe(0);
    expect(stats.primaryLanguage).toBe(null);
    expect(stats.yearOverYearGrowth).toBe(null);
    expect(stats.mostProductiveMonth).toBe(null);
    expect(stats.totalTopics).toBe(0);
    expect(stats.topTopics).toHaveLength(0);
  });

  test("aggregates topics correctly", () => {
    const repos = [
      createRepoInfo({ topics: ["typescript", "github-action", "automation"] }),
      createRepoInfo({ topics: ["typescript", "cli"] }),
      createRepoInfo({ topics: ["python", "automation"] }),
    ];

    const stats = calculateComputedStats(repos, [], createContributionStats([]));

    expect(stats.totalTopics).toBe(5);
    expect(stats.allTopics).toEqual(["automation", "cli", "github-action", "python", "typescript"]);
    
    // Top topics should be sorted by count
    expect(stats.topTopics[0]).toEqual({ name: "typescript", count: 2 });
    expect(stats.topTopics[1]).toEqual({ name: "automation", count: 2 });
  });
});
