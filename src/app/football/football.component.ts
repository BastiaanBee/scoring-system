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

  readonly formByTeam = computed(() => {
    const forms = new Map<number, string[]>();

    const addResult = (teamId: number, result: 'W' | 'D' | 'L'): void => {
      const currentForm = forms.get(teamId) ?? [];
      forms.set(teamId, [...currentForm, result].slice(-5));
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

      if (homeScore === awayScore) {
        addResult(match.homeTeam.id, 'D');
        addResult(match.awayTeam.id, 'D');
      } else if (homeScore > awayScore) {
        addResult(match.homeTeam.id, 'W');
        addResult(match.awayTeam.id, 'L');
      } else {
        addResult(match.homeTeam.id, 'L');
        addResult(match.awayTeam.id, 'W');
      }
    }

    return forms;
  });

  teamForm(teamId: number): string[] {
    return this.formByTeam().get(teamId) ?? [];
  }

  standingsZone(index: number, numberOfClubs: number): string | null {
    if (index === 0) {
      return 'champion';
    }

    if (this.selectedCompetition() === 'PL') {
      return index >= numberOfClubs - 3 ? 'relegated' : null;
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
      this.selectedMatch.set(null);
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
    this.selectedMatch.set(match);

    const dialog = this.matchDialog?.nativeElement;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  closeMatch(): void {
    this.matchDialog?.nativeElement.close();
  }

  handleDialogClose(): void {
    this.selectedMatch.set(null);
  }

  handleDialogBackdropClick(event: MouseEvent): void {
    if (event.target === this.matchDialog?.nativeElement) {
      this.closeMatch();
    }
  }

  isFinished(match: FootballMatch): boolean {
    return match.status === 'FINISHED' || match.status === 'AWARDED';
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      FINISHED: 'Full time',
      AWARDED: 'Awarded',
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
