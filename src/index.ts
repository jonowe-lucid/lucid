#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  parseHealthExport,
  labelForType,
  labelForWorkout,
  HealthData,
  HealthRecord,
  WorkoutRecord,
} from "./parser.js";

// ---- State ----

let healthData: HealthData | null = null;
let exportPath: string | null = null;

// ---- Helpers ----

function ensureLoaded(): HealthData {
  if (!healthData) {
    throw new Error(
      "No Apple Health data loaded. Use the 'load_health_data' tool first with the path to your Export.xml file."
    );
  }
  return healthData;
}

function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}

function filterByDateRange(
  records: { startDate: string }[],
  startDate?: string,
  endDate?: string
) {
  let filtered = records;
  if (startDate) {
    const start = parseDate(startDate);
    filtered = filtered.filter((r) => parseDate(r.startDate) >= start);
  }
  if (endDate) {
    const end = parseDate(endDate);
    filtered = filtered.filter((r) => parseDate(r.startDate) <= end);
  }
  return filtered;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("de-DE") : n.toFixed(2);
}

function aggregateDaily(
  records: HealthRecord[],
  mode: "sum" | "avg"
): { date: string; value: number }[] {
  const byDay = new Map<string, number[]>();
  for (const r of records) {
    const day = r.startDate.slice(0, 10);
    const val = parseFloat(r.value);
    if (isNaN(val)) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(val);
  }

  const result: { date: string; value: number }[] = [];
  for (const [date, values] of [...byDay.entries()].sort()) {
    const value =
      mode === "sum"
        ? values.reduce((a, b) => a + b, 0)
        : values.reduce((a, b) => a + b, 0) / values.length;
    result.push({ date, value });
  }
  return result;
}

// Sum-based types (daily totals make sense)
const SUM_TYPES = new Set([
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierBasalEnergyBurned",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierDistanceCycling",
  "HKQuantityTypeIdentifierFlightsClimbed",
  "HKQuantityTypeIdentifierAppleExerciseTime",
  "HKQuantityTypeIdentifierAppleStandTime",
  "HKQuantityTypeIdentifierDietaryEnergyConsumed",
  "HKQuantityTypeIdentifierDietaryProtein",
  "HKQuantityTypeIdentifierDietaryCarbohydrates",
  "HKQuantityTypeIdentifierDietaryFatTotal",
  "HKQuantityTypeIdentifierDietaryWater",
  "HKQuantityTypeIdentifierDietaryCaffeine",
]);

// ---- MCP Server ----

const server = new McpServer({
  name: "apple-health",
  version: "1.0.0",
});

// Tool: Load health data from Export.xml
server.tool(
  "load_health_data",
  "Load an Apple Health Export.xml file. You must call this first before using any other health data tools. The file path should point to the Export.xml from an Apple Health data export (Settings > Health > Export All Health Data on iPhone).",
  {
    file_path: z
      .string()
      .describe("Absolute path to the Apple Health Export.xml file"),
  },
  async ({ file_path }) => {
    try {
      healthData = await parseHealthExport(file_path);
      exportPath = file_path;

      const summary = [
        `Apple Health data loaded successfully.`,
        ``,
        `Records: ${healthData.records.length.toLocaleString()}`,
        `Workouts: ${healthData.workouts.length.toLocaleString()}`,
        `Data types: ${healthData.recordTypes.length}`,
        `Date range: ${healthData.dateRange.earliest.slice(0, 10)} to ${healthData.dateRange.latest.slice(0, 10)}`,
        ``,
        `Available data types:`,
        ...healthData.recordTypes.map(
          (t) => `  - ${labelForType(t)} (${t})`
        ),
      ];

      return { content: [{ type: "text", text: summary.join("\n") }] };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Error loading file: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: Get a summary / overview
server.tool(
  "health_summary",
  "Get an overview of loaded Apple Health data: total records, date range, available data types, and recent trends.",
  {},
  async () => {
    const data = ensureLoaded();

    // Compute per-type counts
    const typeCounts = new Map<string, number>();
    for (const r of data.records) {
      typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
    }

    // Workout type counts
    const workoutCounts = new Map<string, number>();
    for (const w of data.workouts) {
      workoutCounts.set(
        w.activityType,
        (workoutCounts.get(w.activityType) ?? 0) + 1
      );
    }

    const lines = [
      `# Apple Health Summary`,
      ``,
      `**Total records:** ${data.records.length.toLocaleString()}`,
      `**Total workouts:** ${data.workouts.length.toLocaleString()}`,
      `**Date range:** ${data.dateRange.earliest.slice(0, 10)} — ${data.dateRange.latest.slice(0, 10)}`,
      ``,
      `## Record types (${typeCounts.size}):`,
      ...[...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([type, count]) =>
            `- **${labelForType(type)}**: ${count.toLocaleString()} records`
        ),
      ``,
      `## Workout types (${workoutCounts.size}):`,
      ...[...workoutCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([type, count]) =>
            `- **${labelForWorkout(type)}**: ${count.toLocaleString()} sessions`
        ),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Tool: Query specific health metric
server.tool(
  "query_health_metric",
  "Query a specific health metric (e.g., steps, heart rate, body mass) with optional date filtering. Returns daily aggregated values.",
  {
    type: z
      .string()
      .describe(
        "The health record type identifier, e.g. 'HKQuantityTypeIdentifierStepCount' or 'HKQuantityTypeIdentifierHeartRate'. Use 'health_summary' to see available types."
      ),
    start_date: z
      .string()
      .optional()
      .describe("Filter start date (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("Filter end date (YYYY-MM-DD)"),
    limit: z
      .number()
      .optional()
      .describe("Max number of daily entries to return (default 30, most recent first)"),
  },
  async ({ type, start_date, end_date, limit }) => {
    const data = ensureLoaded();
    const maxEntries = limit ?? 30;

    let filtered = data.records.filter((r) => r.type === type);
    if (filtered.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No records found for type '${type}'. Use 'health_summary' to see available types.`,
          },
        ],
      };
    }

    filtered = filterByDateRange(filtered, start_date, end_date) as HealthRecord[];
    const unit = filtered[0]?.unit ?? "";
    const mode = SUM_TYPES.has(type) ? "sum" : "avg";
    const daily = aggregateDaily(filtered, mode);

    // Most recent first, limited
    const recent = daily.slice(-maxEntries).reverse();

    const lines = [
      `# ${labelForType(type)}`,
      `Unit: ${unit} | Aggregation: daily ${mode} | Showing ${recent.length} of ${daily.length} days`,
      ``,
      `| Date | Value |`,
      `|------|-------|`,
      ...recent.map(
        (d) => `| ${d.date} | ${formatNumber(d.value)} ${unit} |`
      ),
    ];

    // Basic stats
    if (daily.length > 0) {
      const values = daily.map((d) => d.value);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      lines.push(
        ``,
        `**Overall stats** (all ${daily.length} days):`,
        `- Average: ${formatNumber(avg)} ${unit}`,
        `- Min: ${formatNumber(min)} ${unit}`,
        `- Max: ${formatNumber(max)} ${unit}`
      );
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Tool: Query workouts
server.tool(
  "query_workouts",
  "Query workout sessions with optional filtering by activity type and date range.",
  {
    activity_type: z
      .string()
      .optional()
      .describe(
        "Filter by workout activity type, e.g. 'HKWorkoutActivityTypeRunning'. Leave empty for all workouts."
      ),
    start_date: z
      .string()
      .optional()
      .describe("Filter start date (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("Filter end date (YYYY-MM-DD)"),
    limit: z
      .number()
      .optional()
      .describe("Max number of workouts to return (default 20, most recent first)"),
  },
  async ({ activity_type, start_date, end_date, limit }) => {
    const data = ensureLoaded();
    const maxEntries = limit ?? 20;

    let filtered: WorkoutRecord[] = data.workouts;
    if (activity_type) {
      filtered = filtered.filter((w) => w.activityType === activity_type);
    }
    filtered = filterByDateRange(filtered, start_date, end_date) as WorkoutRecord[];

    // Most recent first
    const sorted = [...filtered]
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .slice(0, maxEntries);

    if (sorted.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No workouts found matching the given filters.",
          },
        ],
      };
    }

    const lines = [
      `# Workouts${activity_type ? ` — ${labelForWorkout(activity_type)}` : ""}`,
      `Showing ${sorted.length} of ${filtered.length} workouts`,
      ``,
      `| Date | Type | Duration | Distance | Calories |`,
      `|------|------|----------|----------|----------|`,
      ...sorted.map((w) => {
        const dur = parseFloat(w.duration);
        const dist = parseFloat(w.totalDistance);
        const cal = parseFloat(w.totalEnergyBurned);
        return `| ${w.startDate.slice(0, 10)} | ${labelForWorkout(w.activityType)} | ${isNaN(dur) ? "-" : formatNumber(dur)} min | ${isNaN(dist) ? "-" : formatNumber(dist)} ${w.distanceUnit} | ${isNaN(cal) ? "-" : formatNumber(cal)} ${w.energyUnit} |`;
      }),
    ];

    // Summary stats
    const durations = sorted
      .map((w) => parseFloat(w.duration))
      .filter((d) => !isNaN(d));
    const calories = sorted
      .map((w) => parseFloat(w.totalEnergyBurned))
      .filter((c) => !isNaN(c));

    if (durations.length > 0) {
      lines.push(
        ``,
        `**Stats for shown workouts:**`,
        `- Total duration: ${formatNumber(durations.reduce((a, b) => a + b, 0))} min`,
        `- Avg duration: ${formatNumber(durations.reduce((a, b) => a + b, 0) / durations.length)} min`
      );
    }
    if (calories.length > 0) {
      lines.push(
        `- Total calories: ${formatNumber(calories.reduce((a, b) => a + b, 0))} kcal`,
        `- Avg calories: ${formatNumber(calories.reduce((a, b) => a + b, 0) / calories.length)} kcal`
      );
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Tool: Trends / compare periods
server.tool(
  "health_trends",
  "Compare a health metric across two time periods (e.g., this week vs last week, this month vs last month) to identify trends.",
  {
    type: z
      .string()
      .describe("The health record type identifier to analyze"),
    period_a_start: z.string().describe("Start of period A (YYYY-MM-DD)"),
    period_a_end: z.string().describe("End of period A (YYYY-MM-DD)"),
    period_b_start: z.string().describe("Start of period B (YYYY-MM-DD)"),
    period_b_end: z.string().describe("End of period B (YYYY-MM-DD)"),
  },
  async ({ type, period_a_start, period_a_end, period_b_start, period_b_end }) => {
    const data = ensureLoaded();
    const mode = SUM_TYPES.has(type) ? "sum" : "avg";

    const recordsOfType = data.records.filter((r) => r.type === type);
    if (recordsOfType.length === 0) {
      return {
        content: [{ type: "text", text: `No records found for '${type}'.` }],
      };
    }

    const unit = recordsOfType[0]?.unit ?? "";

    const aRecords = filterByDateRange(recordsOfType, period_a_start, period_a_end) as HealthRecord[];
    const bRecords = filterByDateRange(recordsOfType, period_b_start, period_b_end) as HealthRecord[];

    const aDaily = aggregateDaily(aRecords, mode);
    const bDaily = aggregateDaily(bRecords, mode);

    const avg = (entries: { value: number }[]) =>
      entries.length === 0
        ? 0
        : entries.reduce((a, b) => a + b.value, 0) / entries.length;

    const avgA = avg(aDaily);
    const avgB = avg(bDaily);
    const change = avgA === 0 ? 0 : ((avgB - avgA) / avgA) * 100;

    const lines = [
      `# ${labelForType(type)} — Trend Comparison`,
      ``,
      `| | Period A | Period B |`,
      `|---|---------|---------|`,
      `| Range | ${period_a_start} — ${period_a_end} | ${period_b_start} — ${period_b_end} |`,
      `| Days with data | ${aDaily.length} | ${bDaily.length} |`,
      `| Daily avg | ${formatNumber(avgA)} ${unit} | ${formatNumber(avgB)} ${unit} |`,
      ``,
      `**Change:** ${change >= 0 ? "+" : ""}${formatNumber(change)}%`,
      change > 5
        ? `Trend: Increasing`
        : change < -5
          ? `Trend: Decreasing`
          : `Trend: Stable`,
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// Tool: Search records
server.tool(
  "search_health_data",
  "Search health records by source name, type keyword, or date. Useful for finding specific entries.",
  {
    query: z
      .string()
      .describe("Search term to match against type labels, source names"),
    start_date: z.string().optional().describe("Filter start date (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("Filter end date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max results (default 20)"),
  },
  async ({ query, start_date, end_date, limit }) => {
    const data = ensureLoaded();
    const maxEntries = limit ?? 20;
    const q = query.toLowerCase();

    let matched = data.records.filter((r) => {
      const label = labelForType(r.type).toLowerCase();
      const source = r.sourceName.toLowerCase();
      return label.includes(q) || source.includes(q) || r.type.toLowerCase().includes(q);
    });

    matched = filterByDateRange(matched, start_date, end_date) as HealthRecord[];

    const results = matched.slice(-maxEntries).reverse();

    if (results.length === 0) {
      return {
        content: [
          { type: "text", text: `No records matching '${query}' found.` },
        ],
      };
    }

    const lines = [
      `# Search results for "${query}"`,
      `Showing ${results.length} of ${matched.length} matching records`,
      ``,
      `| Date | Type | Value | Source |`,
      `|------|------|-------|--------|`,
      ...results.map(
        (r) =>
          `| ${r.startDate.slice(0, 16)} | ${labelForType(r.type)} | ${r.value} ${r.unit} | ${r.sourceName} |`
      ),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

// ---- Start server ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Apple Health MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
