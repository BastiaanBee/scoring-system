import { DatePipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EredivisieData, EredivisieMatch, FootballService } from './football.service';

@Component({
  selector: 'app-football',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './football.component.html',
  styleUrl: './football.component.css',
})
export class FootballComponent implements OnInit {
  private readonly footballService = inject(FootballService);

  readonly data = signal<EredivisieData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
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

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    this.error.set(null);

    this.footballService.getEredivisie().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        console.error('Unable to load Eredivisie data:', error);
        this.error.set('The Eredivisie data could not be loaded.');
        this.loading.set(false);
      },
    });
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

  isFinished(match: EredivisieMatch): boolean {
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
}
