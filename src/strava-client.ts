import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---- Types ----

export interface StravaTokens {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface StravaAthlete {
  id: number;
  firstname: string;
  lastname: string;
  city: string;
  state: string;
  country: string;
  sex: string;
  weight: number;
  profile: string;
  created_at: string;
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  start_date: string;
  start_date_local: string;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  average_watts?: number;
  kilojoules?: number;
  suffer_score?: number;
  calories?: number;
  description?: string;
  gear_id?: string;
  average_temp?: number;
  elev_high?: number;
  elev_low?: number;
  pr_count?: number;
  achievement_count?: number;
  kudos_count?: number;
  splits_metric?: StravaSplit[];
  laps?: StravaLap[];
  best_efforts?: StravaBestEffort[];
}

export interface StravaSplit {
  distance: number;
  elapsed_time: number;
  elevation_difference: number;
  moving_time: number;
  split: number;
  average_speed: number;
  average_heartrate?: number;
  pace_zone: number;
}

export interface StravaLap {
  name: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  lap_index: number;
}

export interface StravaBestEffort {
  name: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  start_date_local: string;
}

export interface StravaStats {
  all_ride_totals: StravaTotals;
  all_run_totals: StravaTotals;
  all_swim_totals: StravaTotals;
  recent_ride_totals: StravaTotals;
  recent_run_totals: StravaTotals;
  recent_swim_totals: StravaTotals;
  ytd_ride_totals: StravaTotals;
  ytd_run_totals: StravaTotals;
  ytd_swim_totals: StravaTotals;
  biggest_ride_distance: number;
  biggest_climb_elevation_gain: number;
}

export interface StravaTotals {
  count: number;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  elevation_gain: number;
  achievement_count?: number;
}

// ---- Strava API Client ----

const STRAVA_API = "https://www.strava.com/api/v3";
const TOKEN_URL = "https://www.strava.com/oauth/token";

export class StravaClient {
  private tokens: StravaTokens;
  private tokenPath: string;

  constructor(tokens: StravaTokens, tokenPath: string) {
    this.tokens = tokens;
    this.tokenPath = tokenPath;
  }

  static async fromTokenFile(tokenPath: string): Promise<StravaClient> {
    if (!existsSync(tokenPath)) {
      throw new Error(
        `Token file not found at ${tokenPath}. ` +
          `Run 'node dist/strava-setup.js' to authenticate with Strava.`
      );
    }
    const raw = await readFile(tokenPath, "utf-8");
    const tokens: StravaTokens = JSON.parse(raw);

    if (!tokens.client_id || !tokens.client_secret || !tokens.refresh_token) {
      throw new Error(
        "Invalid token file. Must contain client_id, client_secret, and refresh_token."
      );
    }

    return new StravaClient(tokens, tokenPath);
  }

  private async refreshIfNeeded(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    if (this.tokens.expires_at && this.tokens.expires_at > now + 60) {
      return; // Token still valid
    }

    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.tokens.client_id,
        client_secret: this.tokens.client_secret,
        grant_type: "refresh_token",
        refresh_token: this.tokens.refresh_token,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Token refresh failed (${resp.status}): ${text}`);
    }

    const data = await resp.json();
    this.tokens.access_token = data.access_token;
    this.tokens.refresh_token = data.refresh_token;
    this.tokens.expires_at = data.expires_at;

    // Persist refreshed tokens
    await writeFile(this.tokenPath, JSON.stringify(this.tokens, null, 2));
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    await this.refreshIfNeeded();

    const url = new URL(`${STRAVA_API}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${this.tokens.access_token}` },
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Strava API error (${resp.status}): ${text}`);
    }

    return resp.json() as Promise<T>;
  }

  async getAthlete(): Promise<StravaAthlete> {
    return this.request<StravaAthlete>("/athlete");
  }

  async getStats(athleteId: number): Promise<StravaStats> {
    return this.request<StravaStats>(`/athletes/${athleteId}/stats`);
  }

  async getActivities(
    page = 1,
    perPage = 30,
    before?: string,
    after?: string
  ): Promise<StravaActivity[]> {
    const params: Record<string, string> = {
      page: String(page),
      per_page: String(perPage),
    };
    if (before) params.before = String(Math.floor(new Date(before).getTime() / 1000));
    if (after) params.after = String(Math.floor(new Date(after).getTime() / 1000));
    return this.request<StravaActivity[]>("/athlete/activities", params);
  }

  async getActivity(id: number): Promise<StravaActivity> {
    return this.request<StravaActivity>(`/activities/${id}`, {
      include_all_efforts: "true",
    });
  }
}
