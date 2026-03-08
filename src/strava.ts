#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "path";
import {
  StravaClient,
  StravaActivity,
  StravaTotals,
} from "./strava-client.js";

// ---- Helpers ----

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatPace(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "-";
  const minPerKm = 1000 / metersPerSecond / 60;
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")} /km`;
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}

function formatTotals(label: string, totals: StravaTotals): string[] {
  if (totals.count === 0) return [`**${label}:** No activities`];
  return [
    `**${label}:**`,
    `  - Activities: ${totals.count}`,
    `  - Distance: ${formatDistance(totals.distance)}`,
    `  - Moving time: ${formatDuration(totals.moving_time)}`,
    `  - Elevation gain: ${formatNumber(totals.elevation_gain)} m`,
  ];
}

function activityToRow(a: StravaActivity): string {
  const date = a.start_date_local?.slice(0, 10) ?? a.start_date?.slice(0, 10) ?? "";
  const type = a.sport_type || a.type || "";
  const dist = formatDistance(a.distance ?? 0);
  const dur = formatDuration(a.moving_time ?? 0);
  const hr = a.average_heartrate ? `${Math.round(a.average_heartrate)}` : "-";
  return `| ${date} | ${a.name} | ${type} | ${dist} | ${dur} | ${hr} |`;
}

// ---- MCP Server ----

const server = new McpServer({
  name: "strava",
  version: "1.0.0",
});

// Resolve token file path from env or default
const tokenPath = resolve(
  process.env.STRAVA_TOKEN_FILE ?? "~/.strava-tokens.json".replace("~", process.env.HOME ?? "")
);

let client: StravaClient | null = null;
let athleteId: number | null = null;

async function getClient(): Promise<StravaClient> {
  if (!client) {
    client = await StravaClient.fromTokenFile(tokenPath);
    // Fetch athlete ID for stats endpoint
    const athlete = await client.getAthlete();
    athleteId = athlete.id;
  }
  return client;
}

// Tool: Get athlete profile and overall stats
server.tool(
  "strava_profile",
  "Get your Strava athlete profile and lifetime/YTD/recent stats for running, cycling, and swimming.",
  {},
  async () => {
    try {
      const c = await getClient();
      const athlete = await c.getAthlete();
      athleteId = athlete.id;
      const stats = await c.getStats(athlete.id);

      const lines = [
        `# Strava Profile`,
        ``,
        `**Name:** ${athlete.firstname} ${athlete.lastname}`,
        `**Location:** ${[athlete.city, athlete.state, athlete.country].filter(Boolean).join(", ")}`,
        `**Weight:** ${athlete.weight ? `${athlete.weight} kg` : "not set"}`,
        `**Member since:** ${athlete.created_at?.slice(0, 10) ?? "unknown"}`,
        ``,
        `---`,
        `## Lifetime Stats`,
        ``,
        ...formatTotals("Running", stats.all_run_totals),
        ...formatTotals("Cycling", stats.all_ride_totals),
        ...formatTotals("Swimming", stats.all_swim_totals),
        ``,
        `Biggest ride: ${formatDistance(stats.biggest_ride_distance ?? 0)}`,
        `Biggest climb: ${formatNumber(stats.biggest_climb_elevation_gain ?? 0)} m`,
        ``,
        `## Year to Date`,
        ``,
        ...formatTotals("Running", stats.ytd_run_totals),
        ...formatTotals("Cycling", stats.ytd_ride_totals),
        ...formatTotals("Swimming", stats.ytd_swim_totals),
        ``,
        `## Recent (last 4 weeks)`,
        ``,
        ...formatTotals("Running", stats.recent_run_totals),
        ...formatTotals("Cycling", stats.recent_ride_totals),
        ...formatTotals("Swimming", stats.recent_swim_totals),
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: List activities
server.tool(
  "strava_activities",
  "List your recent Strava activities with optional date filtering. Returns activity names, types, distances, durations, and heart rate.",
  {
    start_date: z
      .string()
      .optional()
      .describe("Only activities after this date (YYYY-MM-DD)"),
    end_date: z
      .string()
      .optional()
      .describe("Only activities before this date (YYYY-MM-DD)"),
    limit: z
      .number()
      .optional()
      .describe("Max number of activities to return (default 30, max 100)"),
    sport_type: z
      .string()
      .optional()
      .describe("Filter by sport type, e.g. 'Run', 'Ride', 'Swim', 'Walk', 'Hike', 'WeightTraining'"),
  },
  async ({ start_date, end_date, limit, sport_type }) => {
    try {
      const c = await getClient();
      const maxItems = Math.min(limit ?? 30, 100);

      // Fetch multiple pages if needed
      let activities: StravaActivity[] = [];
      let page = 1;
      while (activities.length < maxItems) {
        const batch = await c.getActivities(page, Math.min(maxItems, 50), end_date, start_date);
        if (batch.length === 0) break;
        activities.push(...batch);
        page++;
      }

      // Apply sport_type filter client-side
      if (sport_type) {
        const st = sport_type.toLowerCase();
        activities = activities.filter(
          (a) =>
            (a.sport_type ?? "").toLowerCase() === st ||
            (a.type ?? "").toLowerCase() === st
        );
      }

      activities = activities.slice(0, maxItems);

      if (activities.length === 0) {
        return {
          content: [{ type: "text", text: "No activities found matching the given filters." }],
        };
      }

      const lines = [
        `# Strava Activities`,
        `Showing ${activities.length} activities`,
        ``,
        `| Date | Name | Type | Distance | Duration | Avg HR |`,
        `|------|------|------|----------|----------|--------|`,
        ...activities.map(activityToRow),
      ];

      // Summary
      const totalDist = activities.reduce((s, a) => s + (a.distance ?? 0), 0);
      const totalTime = activities.reduce((s, a) => s + (a.moving_time ?? 0), 0);
      const totalElev = activities.reduce((s, a) => s + (a.total_elevation_gain ?? 0), 0);

      lines.push(
        ``,
        `**Totals:** ${formatDistance(totalDist)} | ${formatDuration(totalTime)} | ${formatNumber(totalElev)} m elevation`
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Get activity details
server.tool(
  "strava_activity_detail",
  "Get detailed information about a specific Strava activity including splits, laps, and best efforts (for runs).",
  {
    activity_id: z.number().describe("The Strava activity ID"),
  },
  async ({ activity_id }) => {
    try {
      const c = await getClient();
      const a = await c.getActivity(activity_id);

      const lines = [
        `# ${a.name}`,
        ``,
        `**Type:** ${a.sport_type || a.type}`,
        `**Date:** ${a.start_date_local?.slice(0, 16) ?? a.start_date}`,
        `**Distance:** ${formatDistance(a.distance ?? 0)}`,
        `**Duration:** ${formatDuration(a.moving_time ?? 0)} moving / ${formatDuration(a.elapsed_time ?? 0)} elapsed`,
        `**Elevation:** +${formatNumber(a.total_elevation_gain ?? 0)} m (${formatNumber(a.elev_low ?? 0)} - ${formatNumber(a.elev_high ?? 0)} m)`,
        `**Avg speed:** ${formatPace(a.average_speed ?? 0)} (${((a.average_speed ?? 0) * 3.6).toFixed(1)} km/h)`,
        `**Max speed:** ${((a.max_speed ?? 0) * 3.6).toFixed(1)} km/h`,
      ];

      if (a.average_heartrate) {
        lines.push(
          `**Heart rate:** avg ${Math.round(a.average_heartrate)} / max ${Math.round(a.max_heartrate ?? 0)} bpm`
        );
      }
      if (a.average_cadence) {
        lines.push(`**Cadence:** ${Math.round(a.average_cadence * 2)} spm`);
      }
      if (a.average_watts) {
        lines.push(`**Power:** ${Math.round(a.average_watts)} W`);
      }
      if (a.calories) {
        lines.push(`**Calories:** ${formatNumber(a.calories)} kcal`);
      }
      if (a.suffer_score) {
        lines.push(`**Suffer score:** ${a.suffer_score}`);
      }
      if (a.average_temp !== undefined) {
        lines.push(`**Temperature:** ${a.average_temp}°C`);
      }
      if (a.description) {
        lines.push(``, `**Description:** ${a.description}`);
      }

      lines.push(
        ``,
        `**PRs:** ${a.pr_count ?? 0} | **Achievements:** ${a.achievement_count ?? 0} | **Kudos:** ${a.kudos_count ?? 0}`
      );

      // Splits
      if (a.splits_metric && a.splits_metric.length > 0) {
        lines.push(
          ``,
          `## Splits (per km)`,
          ``,
          `| KM | Pace | HR | Elevation |`,
          `|----|------|----|-----------|`,
          ...a.splits_metric.map((s) => {
            const pace = formatPace(s.average_speed);
            const hr = s.average_heartrate ? `${Math.round(s.average_heartrate)}` : "-";
            const elev = `${s.elevation_difference > 0 ? "+" : ""}${formatNumber(s.elevation_difference)} m`;
            return `| ${s.split} | ${pace} | ${hr} | ${elev} |`;
          })
        );
      }

      // Laps
      if (a.laps && a.laps.length > 1) {
        lines.push(
          ``,
          `## Laps`,
          ``,
          `| # | Name | Distance | Time | Pace | HR |`,
          `|---|------|----------|------|------|----|`,
          ...a.laps.map((l) => {
            const hr = l.average_heartrate ? `${Math.round(l.average_heartrate)}` : "-";
            return `| ${l.lap_index} | ${l.name} | ${formatDistance(l.distance)} | ${formatDuration(l.moving_time)} | ${formatPace(l.average_speed)} | ${hr} |`;
          })
        );
      }

      // Best efforts
      if (a.best_efforts && a.best_efforts.length > 0) {
        lines.push(
          ``,
          `## Best Efforts`,
          ``,
          `| Effort | Time |`,
          `|--------|------|`,
          ...a.best_efforts.map(
            (e) => `| ${e.name} | ${formatDuration(e.elapsed_time)} |`
          )
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Weekly summary
server.tool(
  "strava_weekly_summary",
  "Get a weekly training summary — total distance, time, elevation, and activity breakdown for the last N weeks.",
  {
    weeks: z
      .number()
      .optional()
      .describe("Number of weeks to summarize (default 4)"),
  },
  async ({ weeks }) => {
    try {
      const c = await getClient();
      const numWeeks = weeks ?? 4;

      // Fetch activities for the period
      const now = new Date();
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - numWeeks * 7);

      const activities = await c.getActivities(
        1,
        100,
        undefined,
        startDate.toISOString().slice(0, 10)
      );

      // Group by ISO week
      const byWeek = new Map<string, StravaActivity[]>();
      for (const a of activities) {
        const d = new Date(a.start_date_local ?? a.start_date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay() + 1); // Monday
        const key = weekStart.toISOString().slice(0, 10);
        if (!byWeek.has(key)) byWeek.set(key, []);
        byWeek.get(key)!.push(a);
      }

      const lines = [
        `# Weekly Training Summary`,
        `Last ${numWeeks} weeks`,
        ``,
      ];

      const sortedWeeks = [...byWeek.entries()].sort((a, b) =>
        b[0].localeCompare(a[0])
      );

      for (const [weekStart, acts] of sortedWeeks) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const totalDist = acts.reduce((s, a) => s + (a.distance ?? 0), 0);
        const totalTime = acts.reduce((s, a) => s + (a.moving_time ?? 0), 0);
        const totalElev = acts.reduce(
          (s, a) => s + (a.total_elevation_gain ?? 0),
          0
        );

        // Breakdown by type
        const byType = new Map<string, number>();
        for (const a of acts) {
          const t = a.sport_type || a.type || "Other";
          byType.set(t, (byType.get(t) ?? 0) + 1);
        }
        const typeBreakdown = [...byType.entries()]
          .map(([t, c]) => `${t} ×${c}`)
          .join(", ");

        lines.push(
          `## Week of ${weekStart} — ${weekEnd.toISOString().slice(0, 10)}`,
          `- **Activities:** ${acts.length} (${typeBreakdown})`,
          `- **Distance:** ${formatDistance(totalDist)}`,
          `- **Time:** ${formatDuration(totalTime)}`,
          `- **Elevation:** ${formatNumber(totalElev)} m`,
          ``
        );
      }

      if (sortedWeeks.length === 0) {
        lines.push("No activities found in this period.");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Training load / fitness analysis
server.tool(
  "strava_training_analysis",
  "Analyze your training load over a period — volume progression, intensity distribution, and consistency metrics.",
  {
    days: z
      .number()
      .optional()
      .describe("Number of days to analyze (default 90)"),
    sport_type: z
      .string()
      .optional()
      .describe("Filter by sport type, e.g. 'Run', 'Ride'"),
  },
  async ({ days, sport_type }) => {
    try {
      const c = await getClient();
      const numDays = days ?? 90;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - numDays);

      let activities = await c.getActivities(
        1,
        200,
        undefined,
        startDate.toISOString().slice(0, 10)
      );

      if (sport_type) {
        const st = sport_type.toLowerCase();
        activities = activities.filter(
          (a) =>
            (a.sport_type ?? "").toLowerCase() === st ||
            (a.type ?? "").toLowerCase() === st
        );
      }

      if (activities.length === 0) {
        return {
          content: [
            { type: "text", text: "No activities found in this period." },
          ],
        };
      }

      // Weekly volumes
      const weeklyVolume = new Map<string, { dist: number; time: number; count: number }>();
      for (const a of activities) {
        const d = new Date(a.start_date_local ?? a.start_date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay() + 1);
        const key = weekStart.toISOString().slice(0, 10);
        const entry = weeklyVolume.get(key) ?? { dist: 0, time: 0, count: 0 };
        entry.dist += a.distance ?? 0;
        entry.time += a.moving_time ?? 0;
        entry.count++;
        weeklyVolume.set(key, entry);
      }

      const sortedWeeks = [...weeklyVolume.entries()].sort();

      // Heart rate zones distribution (if HR data available)
      const hrActivities = activities.filter((a) => a.average_heartrate);
      const hrZones = { easy: 0, moderate: 0, hard: 0, max: 0 };
      for (const a of hrActivities) {
        const hr = a.average_heartrate!;
        if (hr < 140) hrZones.easy++;
        else if (hr < 160) hrZones.moderate++;
        else if (hr < 175) hrZones.hard++;
        else hrZones.max++;
      }

      // Compute averages
      const totalDist = activities.reduce((s, a) => s + (a.distance ?? 0), 0);
      const totalTime = activities.reduce((s, a) => s + (a.moving_time ?? 0), 0);
      const totalElev = activities.reduce((s, a) => s + (a.total_elevation_gain ?? 0), 0);
      const activeDays = new Set(
        activities.map((a) => (a.start_date_local ?? a.start_date).slice(0, 10))
      ).size;

      const lines = [
        `# Training Analysis`,
        `Period: last ${numDays} days${sport_type ? ` (${sport_type})` : ""}`,
        ``,
        `## Overview`,
        `- **Activities:** ${activities.length}`,
        `- **Active days:** ${activeDays} / ${numDays} (${Math.round((activeDays / numDays) * 100)}%)`,
        `- **Total distance:** ${formatDistance(totalDist)}`,
        `- **Total time:** ${formatDuration(totalTime)}`,
        `- **Total elevation:** ${formatNumber(totalElev)} m`,
        `- **Avg per activity:** ${formatDistance(totalDist / activities.length)} / ${formatDuration(totalTime / activities.length)}`,
        `- **Avg per week:** ${formatDistance(totalDist / (numDays / 7))} / ${formatDuration(totalTime / (numDays / 7))}`,
        ``,
        `## Weekly Volume Progression`,
        ``,
        `| Week | Activities | Distance | Time |`,
        `|------|-----------|----------|------|`,
        ...sortedWeeks.map(
          ([week, v]) =>
            `| ${week} | ${v.count} | ${formatDistance(v.dist)} | ${formatDuration(v.time)} |`
        ),
      ];

      if (hrActivities.length > 0) {
        const total = hrActivities.length;
        lines.push(
          ``,
          `## Intensity Distribution (by avg HR)`,
          `- Easy (<140 bpm): ${hrZones.easy} activities (${Math.round((hrZones.easy / total) * 100)}%)`,
          `- Moderate (140-160 bpm): ${hrZones.moderate} activities (${Math.round((hrZones.moderate / total) * 100)}%)`,
          `- Hard (160-175 bpm): ${hrZones.hard} activities (${Math.round((hrZones.hard / total) * 100)}%)`,
          `- Max (>175 bpm): ${hrZones.max} activities (${Math.round((hrZones.max / total) * 100)}%)`
        );
      }

      // Trend (compare first half vs second half)
      const mid = Math.floor(sortedWeeks.length / 2);
      if (sortedWeeks.length >= 4) {
        const firstHalf = sortedWeeks.slice(0, mid);
        const secondHalf = sortedWeeks.slice(mid);
        const avgFirst =
          firstHalf.reduce((s, [, v]) => s + v.dist, 0) / firstHalf.length;
        const avgSecond =
          secondHalf.reduce((s, [, v]) => s + v.dist, 0) / secondHalf.length;
        const change = avgFirst === 0 ? 0 : ((avgSecond - avgFirst) / avgFirst) * 100;

        lines.push(
          ``,
          `## Volume Trend`,
          `- First half avg: ${formatDistance(avgFirst)}/week`,
          `- Second half avg: ${formatDistance(avgSecond)}/week`,
          `- Change: ${change >= 0 ? "+" : ""}${formatNumber(change)}%`,
          change > 10
            ? "Trend: Building volume"
            : change < -10
              ? "Trend: Decreasing volume"
              : "Trend: Stable volume"
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ---- Start server ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Strava MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
