# GitHub Stats Action

A GitHub Action that collects comprehensive statistics for a user's GitHub profile and outputs them to a JSON file. Perfect for building profile READMEs, dashboards, or personal analytics.

## Features

- **Profile Data**: Name, bio, company, location, social links
- **Contribution Stats**: Total contributions, streaks, most active day, monthly breakdown
- **Repository Metrics**: Stars, forks, views, top repositories
- **Code Statistics**: Lines added/deleted, commit counts, languages with percentages
- **Social Stats**: Followers, following, stars given
- **Activity Data**: Pull requests, issues, PR reviews, discussions

## Requirements

### Personal Access Token (PAT)

This action **requires a Personal Access Token** - the default `GITHUB_TOKEN` will not work because:

- Contribution calendar data requires authentication as the actual user
- Repository view counts require push access across all repositories
- The `viewer` GraphQL query returns data for the token owner

#### Required PAT Scopes

| Scope | Purpose |
|-------|---------|
| `read:user` | Access user profile data |
| `repo` | Access repository statistics, views, and private repos |

#### Creating a PAT

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click "Generate new token"
3. Select the scopes listed above
4. Copy the token and add it as a repository secret (e.g., `USER_PAT`)

## Usage

### Basic Workflow

Create `.github/workflows/stats.yaml`:

```yaml
name: Collect GitHub Stats

on:
  schedule:
    - cron: '0 0 * * *'  # Run daily at midnight
  workflow_dispatch:      # Allow manual trigger

jobs:
  collect-stats:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Collect GitHub Stats
        uses: LukeHagar/stats-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.USER_PAT }}

      - name: Commit stats
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: update github stats"
          file_pattern: github-user-stats.json
```

### Template Repository

For a complete setup with visualization, use the [stats template repository](https://github.com/LukeHagar/stats/).

## Output

The action creates a `github-user-stats.json` file with the following structure:

### Profile Information

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `username` | string | GitHub username |
| `avatarUrl` | string | Profile picture URL |
| `bio` | string \| null | Profile bio |
| `company` | string \| null | Company name |
| `location` | string \| null | Location |
| `email` | string \| null | Public email |
| `twitterUsername` | string \| null | Twitter/X handle |
| `websiteUrl` | string \| null | Website URL |
| `createdAt` | string | Account creation date (ISO 8601) |

### Statistics

| Field | Type | Description |
|-------|------|-------------|
| `totalCommits` | number | Total commits (from GitHub search) |
| `commitCount` | number | Commits from contributor stats |
| `totalPullRequests` | number | Total PRs created |
| `totalPullRequestReviews` | number | Total PR reviews |
| `totalContributions` | number | All-time contributions |
| `openIssues` | number | Open issues created |
| `closedIssues` | number | Closed issues created |
| `discussionsStarted` | number | Discussions started |
| `discussionsAnswered` | number | Discussion answers marked as correct |
| `repositoriesContributedTo` | number | Repos contributed to |

### Repository Metrics

| Field | Type | Description |
|-------|------|-------------|
| `starCount` | number | Total stars received |
| `forkCount` | number | Total forks of your repos |
| `starsGiven` | number | Repos you've starred |
| `repoViews` | number | Total repo views (last 14 days) |

### Code Statistics

| Field | Type | Description |
|-------|------|-------------|
| `linesAdded` | number | Total lines added |
| `linesDeleted` | number | Total lines deleted |
| `linesOfCodeChanged` | number | Total lines changed (added + deleted) |
| `codeByteTotal` | number | Total bytes of code |

### Social

| Field | Type | Description |
|-------|------|-------------|
| `followers` | number | Follower count |
| `following` | number | Following count |

### Languages

```json
{
  "topLanguages": [
    {
      "languageName": "TypeScript",
      "color": "#3178c6",
      "value": 1234567,
      "percentage": 45.5
    }
  ]
}
```

### Contribution Stats

```json
{
  "contributionStats": {
    "longestStreak": 42,
    "currentStreak": 7,
    "mostActiveDay": "Tuesday",
    "averagePerDay": 3.5,
    "averagePerWeek": 24.5,
    "averagePerMonth": 105.0,
    "monthlyBreakdown": [
      { "month": "2024-01", "contributions": 120 }
    ]
  }
}
```

### Top Repositories

```json
{
  "topRepos": [
    {
      "name": "repo-name",
      "description": "Repo description",
      "stars": 100,
      "forks": 25,
      "isArchived": false,
      "primaryLanguage": "TypeScript",
      "updatedAt": "2024-01-15T10:30:00Z",
      "createdAt": "2023-06-01T08:00:00Z"
    }
  ]
}
```

### Full Contribution Calendar

The `contributionsCollection` field contains the complete contribution calendar with daily data for building heatmaps.

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.0+

### Setup

```bash
# Install dependencies
bun install

# Run locally (requires GITHUB_TOKEN env var)
export GITHUB_TOKEN=your_pat_here
bun run start

# Run tests
bun test

# Type check
bun run typecheck
```

### Project Structure

```
├── src/
│   ├── index.ts       # Main action logic
│   ├── index.test.ts  # Tests
│   └── Types.ts       # TypeScript type definitions
├── action.yml         # GitHub Action definition
├── package.json
└── tsconfig.json
```

## License

MIT - see [LICENSE.md](LICENSE.md)
