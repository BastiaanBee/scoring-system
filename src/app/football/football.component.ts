import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  ElementRef,
  inject,
  linkedSignal,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  CompetitionCode,
  CompetitionData,
  FootballMatch,
  FootballService,
  FootballTeam,
} from './football.service';

@Component({
  selector: 'app-football',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './football.component.html',
  styleUrl: './football.component.css',
})
export class FootballComponent implements OnInit {
  constructor(private router: Router) {}
  private readonly footballService = inject(FootballService);

  readonly competitions: ReadonlyArray<{
    code: CompetitionCode;
    label: string;
  }> = [
    { code: 'DED', label: 'Eredivisie' },
    { code: 'PL', label: 'Premier League' },
  ];

  readonly selectedCompetition = signal<CompetitionCode>('DED');

  private readonly teamNameOverrides: Record<string, string> = {
    'ADO Den Haag': 'ADO Den Haag',
    'Den Haag': 'ADO Den Haag',
    'FC Den Haag': 'ADO Den Haag',
    Sittard: 'Fortuna Sittard',
    Zwolle: 'PEC Zwolle',
    Twente: 'FC Twente',
    NEC: 'N.E.C.',
    'Go Ahead': 'Go Ahead Eagles',
    Sparta: 'Sparta Rotterdam',
    Groningen: 'FC Groningen',
    Utrecht: 'FC Utrecht',
    'Man United': 'Manchester United',
    'Man City': 'Manchester City',
    Newcastle: 'Newcastle United',
  };

  displayTeamName(team: FootballTeam): string {
    const originalLabel = team.shortName ?? team.name;

    return (
      this.teamNameOverrides[team.name] ?? this.teamNameOverrides[originalLabel] ?? originalLabel
    );
  }

  @ViewChild('matchDialog') private matchDialog?: ElementRef<HTMLDialogElement>;

  readonly data = signal<CompetitionData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedMatch = signal<FootballMatch | null>(null);
  readonly selectedClub = signal<FootballTeam | null>(null);
  readonly returnClub = signal<FootballTeam | null>(null);
  private readonly returnClubSourceMatch = signal<FootballMatch | null>(null);
  readonly selectedMatchday = linkedSignal(() => this.data()?.season.currentMatchday ?? 1);

  readonly matchdays = computed(() => {
    const matches = this.data()?.matches ?? [];

    return [...new Set(matches.map((match) => match.matchday))].sort(
      (first, second) => first - second,
    );
  });

  readonly selectedMatches = computed(() =>
    (this.data()?.matches ?? []).filter((match) => match.matchday === this.selectedMatchday()),
  );

  readonly selectedClubStanding = computed(() => {
    const club = this.selectedClub();

    if (!club) {
      return null;
    }

    return this.data()?.standings.find((standing) => standing.team.id === club.id) ?? null;
  });

  readonly selectedClubDetails = computed(() => {
    const club = this.selectedClub();

    if (!club) {
      return null;
    }

    return this.data()?.clubs.find((details) => details.id === club.id) ?? null;
  });

  readonly selectedClubMatches = computed(() => {
    const club = this.selectedClub();

    if (!club) {
      return [];
    }

    return (this.data()?.matches ?? []).filter(
      (match) => match.homeTeam.id === club.id || match.awayTeam.id === club.id,
    );
  });

  readonly selectedClubLiveMatch = computed(
    () => this.selectedClubMatches().find((match) => this.isLive(match)) ?? null,
  );

  readonly selectedClubPreviousMatch = computed(() => {
    return (
      this.selectedClubMatches()
        .filter((match) => this.isFinished(match))
        .sort((first, second) => second.utcDate.localeCompare(first.utcDate))[0] ?? null
    );
  });

  readonly selectedClubNextMatch = computed(() => {
    return (
      this.selectedClubMatches()
        .filter((match) => match.status === 'SCHEDULED' || match.status === 'TIMED')
        .sort((first, second) => first.utcDate.localeCompare(second.utcDate))[0] ?? null
    );
  });

  readonly selectedClubMatchHighlights = computed(() => {
    const highlights: Array<{
      label: string;
      match: FootballMatch;
    }> = [];

    const liveMatch = this.selectedClubLiveMatch();
    const nextMatch = this.selectedClubNextMatch();
    const previousMatch = this.selectedClubPreviousMatch();

    if (previousMatch) {
      highlights.push({
        label: 'Previous match',
        match: previousMatch,
      });
    }

    if (liveMatch) {
      highlights.push({
        label: 'Live match',
        match: liveMatch,
      });
    }

    if (nextMatch) {
      highlights.push({
        label: 'Next match',
        match: nextMatch,
      });
    }

    return highlights;
  });

  readonly selectedClubStreak = computed(() => {
    const club = this.selectedClub();

    if (!club) {
      return null;
    }

    const form = this.teamForm(club.id);

    if (form.length === 0) {
      return null;
    }

    const latestResult = form[form.length - 1] as 'W' | 'D' | 'L';
    let length = 0;

    for (let index = form.length - 1; index >= 0; index--) {
      if (form[index] !== latestResult) {
        break;
      }

      length++;
    }

    const singleResultLabels = {
      W: 'Last match: win',
      D: 'Last match: draw',
      L: 'Last match: loss',
    };

    const streakLabels = {
      W: `${length}-match winning streak`,
      D: `${length}-match drawing streak`,
      L: `${length}-match losing streak`,
    };

    return {
      result: latestResult,
      label: length === 1 ? singleResultLabels[latestResult] : streakLabels[latestResult],
    };
  });

  readonly formByTeam = computed(() => {
    const forms = new Map<
      number,
      Array<{
        result: 'W' | 'D' | 'L';
        label: string;
      }>
    >();

    const addResult = (teamId: number, result: 'W' | 'D' | 'L', label: string): void => {
      const currentForm = forms.get(teamId) ?? [];

      forms.set(teamId, [...currentForm, { result, label }].slice(-5));
    };

    const matches = [...(this.data()?.matches ?? [])].sort((first, second) =>
      first.utcDate.localeCompare(second.utcDate),
    );

    for (const match of matches) {
      if (!this.isFinished(match)) {
        continue;
      }

      const homeScore = match.score.fullTime.home;
      const awayScore = match.score.fullTime.away;

      if (homeScore === null || awayScore === null) {
        continue;
      }

      const label =
        `${this.displayTeamName(match.homeTeam)} ` +
        `${homeScore}-${awayScore} ` +
        `${this.displayTeamName(match.awayTeam)}`;

      if (homeScore === awayScore) {
        addResult(match.homeTeam.id, 'D', label);
        addResult(match.awayTeam.id, 'D', label);
      } else if (homeScore > awayScore) {
        addResult(match.homeTeam.id, 'W', label);
        addResult(match.awayTeam.id, 'L', label);
      } else {
        addResult(match.homeTeam.id, 'L', label);
        addResult(match.awayTeam.id, 'W', label);
      }
    }

    return forms;
  });

  teamFormEntries(teamId: number) {
    return this.formByTeam().get(teamId) ?? [];
  }

  teamForm(teamId: number): Array<'W' | 'D' | 'L'> {
    return this.teamFormEntries(teamId).map((entry) => entry.result);
  }

  standingsZone(index: number, numberOfClubs: number): string | null {
    if (index === 0) {
      return 'champion';
    }

    if (this.selectedCompetition() === 'PL') {
      if (index <= 3) {
        return 'europe';
      }

      if (index === 4) {
        return 'europe-playoff';
      }

      if (index >= numberOfClubs - 3) {
        return 'relegated';
      }

      return null;
    }

    if (index <= 2) {
      return 'europe';
    }

    if (index <= 6) {
      return 'europe-playoff';
    }

    if (index === numberOfClubs - 3) {
      return 'relegation-playoff';
    }

    if (index >= numberOfClubs - 2) {
      return 'relegated';
    }

    return null;
  }

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    this.error.set(null);
    const competitionCode = this.selectedCompetition();

    this.footballService.getCompetition(competitionCode).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        console.error(`Unable to load ${competitionCode} data:`, error);
        this.error.set('The competition data could not be loaded.');
        this.loading.set(false);
      },
    });
  }

  selectCompetition(competitionCode: CompetitionCode): void {
    if (competitionCode === this.selectedCompetition() || this.loading()) {
      return;
    }

    const dialog = this.matchDialog?.nativeElement;

    if (dialog?.open) {
      dialog.close();
    } else {
      this.returnClub.set(null);
      this.returnClubSourceMatch.set(null);
      this.selectedMatch.set(null);
      this.selectedClub.set(null);
    }

    this.selectedCompetition.set(competitionCode);
    this.data.set(null);
    this.loadData();
  }

  selectMatchday(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedMatchday.set(Number(select.value));
  }

  previousMatchday(): void {
    const days = this.matchdays();
    const index = days.indexOf(this.selectedMatchday());

    if (index > 0) {
      this.selectedMatchday.set(days[index - 1]);
    }
  }

  nextMatchday(): void {
    const days = this.matchdays();
    const index = days.indexOf(this.selectedMatchday());

    if (index >= 0 && index < days.length - 1) {
      this.selectedMatchday.set(days[index + 1]);
    }
  }

  openMatch(match: FootballMatch): void {
    this.returnClub.set(null);
    this.returnClubSourceMatch.set(null);
    this.selectedClub.set(null);
    this.selectedMatch.set(match);

    const dialog = this.matchDialog?.nativeElement;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  openMatchFromClub(match: FootballMatch): void {
    const club = this.selectedClub();

    if (!club) {
      this.openMatch(match);
      return;
    }

    this.returnClub.set(club);
    this.returnClubSourceMatch.set(this.selectedMatch());
    this.selectedClub.set(null);
    this.selectedMatch.set(match);
  }

  backToClub(): void {
    const club = this.returnClub();

    if (!club) {
      return;
    }

    this.selectedClub.set(club);
    this.selectedMatch.set(this.returnClubSourceMatch());
    this.returnClub.set(null);
    this.returnClubSourceMatch.set(null);
  }

  openClub(team: FootballTeam, sourceMatch: FootballMatch | null = null): void {
    this.returnClub.set(null);
    this.returnClubSourceMatch.set(null);
    this.selectedMatch.set(sourceMatch);
    this.selectedClub.set(team);

    const dialog = this.matchDialog?.nativeElement;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  backToMatch(): void {
    if (this.selectedMatch()) {
      this.selectedClub.set(null);
    }
  }

  closeMatch(): void {
    this.matchDialog?.nativeElement.close();
  }

  handleDialogClose(): void {
    this.selectedMatch.set(null);
    this.selectedClub.set(null);
    this.returnClub.set(null);
    this.returnClubSourceMatch.set(null);
  }

  handleDialogBackdropClick(event: MouseEvent): void {
    if (event.target === this.matchDialog?.nativeElement) {
      this.closeMatch();
    }
  }

  isFinished(match: FootballMatch): boolean {
    return match.status === 'FINISHED' || match.status === 'AWARDED';
  }

  isLive(match: FootballMatch): boolean {
    return match.status === 'LIVE' || match.status === 'IN_PLAY' || match.status === 'PAUSED';
  }

  hasHalfTimeScore(match: FootballMatch): boolean {
    const halfTime = match.score.halfTime;

    return (
      this.isLive(match) && typeof halfTime?.home === 'number' && typeof halfTime?.away === 'number'
    );
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      FINISHED: 'Full time',
      AWARDED: 'Awarded',
      LIVE: 'In progress',
      IN_PLAY: 'In progress',
      PAUSED: 'Half-time',
      POSTPONED: 'Postponed',
      SUSPENDED: 'Suspended',
      CANCELLED: 'Cancelled',
      SCHEDULED: 'Scheduled',
      TIMED: 'Scheduled',
    };

    return labels[status] ?? status.replaceAll('_', ' ').toLowerCase();
  }

  goHome() {
    this.router.navigate(['/']);
  }
}
