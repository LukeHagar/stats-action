import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatNumber,
  aggregateLanguages,
  calculateContributionStats,
  processBatched,
} from "./index";
import type { ContributionsCollection } from "./Types";

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

describe("processBatched", () => {
  test("processes items in batches", async () => {
    const items = [1, 2, 3, 4, 5];
    const processedOrder: number[] = [];

    const results = await processBatched(items, 2, async (item) => {
      processedOrder.push(item);
      return item * 2;
    });

    expect(results).toHaveLength(5);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);

    const values = results
      .filter((r): r is PromiseFulfilledResult<number> => r.status === "fulfilled")
      .map((r) => r.value);
    expect(values).toEqual([2, 4, 6, 8, 10]);
  });

  test("handles errors gracefully with Promise.allSettled", async () => {
    const items = [1, 2, 3];

    const results = await processBatched(items, 2, async (item) => {
      if (item === 2) throw new Error("Test error");
      return item;
    });

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("rejected");
    expect(results[2].status).toBe("fulfilled");
  });

  test("processes single batch correctly", async () => {
    const items = [1, 2, 3];

    const results = await processBatched(items, 10, async (item) => item);

    expect(results).toHaveLength(3);
  });

  test("handles empty array", async () => {
    const results = await processBatched([], 5, async (item: number) => item);
    expect(results).toHaveLength(0);
  });
});

