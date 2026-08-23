import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

export type CompetitionCode = 'DED' | 'PL' | 'BL1';

export interface FootballTeam {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
}

export interface FootballArea {
  id: number;
  name: string | null;
  code: string | null;
  flag: string | null;
}

export interface FootballRunningCompetition {
  id: number;
  name: string;
  code: string | null;
  type: string | null;
  emblem: string | null;
}

export interface FootballClubDetails extends FootballTeam {
  address: string | null;
  website: string | null;
  founded: number | null;
  clubColors: string | null;
  venue: string | null;
  area: FootballArea | null;
  runningCompetitions: FootballRunningCompetition[];
}

export interface StandingRow {
  position: number;
  team: FootballTeam;
  playedGames: number;
  form: string[];
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface FootballMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number;
  venue?: string | null;
  referee?: string | null;
  homeTeam: FootballTeam;
  awayTeam: FootballTeam;
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    fullTime: {
      home: number | null;
      away: number | null;
    };
    halfTime?: {
      home: number | null;
      away: number | null;
    };
  };
  lastUpdated: string | null;
}

export interface CompetitionData {
  competition: {
    id: number;
    name: string;
    code: string;
    emblem: string | null;
  };
  season: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number | null;
  };
  standings: StandingRow[];
  matches: FootballMatch[];
  clubs: FootballClubDetails[];
  updatedAt: string;
}

@Injectable({
  providedIn: 'root',
})
export class FootballService {
  private readonly http = inject(HttpClient);

  getCompetition(competitionCode: CompetitionCode) {
    return this.http.get<CompetitionData>(`/api/eredivisie?v=2&competition=${competitionCode}`);
  }
}
