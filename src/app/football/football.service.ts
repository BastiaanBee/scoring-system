import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

export interface FootballTeam {
  id: number;
  name: string;
  shortName: string | null;
  tla: string | null;
  crest: string | null;
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

export interface EredivisieMatch {
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

export interface EredivisieData {
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
  matches: EredivisieMatch[];
  updatedAt: string;
}

@Injectable({
  providedIn: 'root',
})
export class FootballService {
  private readonly http = inject(HttpClient);

  getEredivisie() {
    return this.http.get<EredivisieData>('/api/eredivisie?v=2');
  }
}
