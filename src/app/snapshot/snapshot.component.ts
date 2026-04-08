// snapshot.component.ts — read-only reveal page for a specific voting round.
// Loaded from a shared link by viewers. Fetches snapshot data from Firestore
// and lets the viewer click through the reveal sequence independently.
import { Component, OnInit, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { doc, getDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../firebase.config';

@Component({
  selector: 'app-snapshot',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './snapshot.component.html',
  styleUrl: './snapshot.component.css',
  encapsulation: ViewEncapsulation.None
})
export class SnapshotComponent implements OnInit {

  constructor(private route: ActivatedRoute, private cdr: ChangeDetectorRef) {
    console.log('SnapshotComponent constructed');
  }

  // =====================================================
  // LOADING STATE
  // =====================================================

  // Whether the snapshot is currently being fetched from Firestore.
  loading = true;

  // Error message shown if the snapshot cannot be loaded.
  error = '';

  // =====================================================
  // SNAPSHOT DATA
  // Loaded from Firestore on init.
  // =====================================================

  contestTitle    = '';
  voter           = '';
  maxPointValue   = 0;

  // The scoreboard as it was BEFORE this round's points were awarded.
  preRoundSnapshot: {
    name:           string,
    country:        string,
    artist:         string,
    song:           string,
    points:         number,
    scoreCounts:    { [points: number]: number },
    maxPointVoters: string[]
  }[] = [];

  // The votes cast this round, sorted lowest to highest.
  lastRoundVotes: { contestant: string; points: number }[] = [];

  // =====================================================
  // REVEAL STATE
  // Mirrors the reveal logic from the main app.
  // =====================================================

  // The scoreboard as displayed — starts at pre-round state,
  // updated one point at a time as the viewer clicks Next.
  displayContestants: {
    name:           string,
    country:        string,
    artist:         string,
    song:           string,
    points:         number,
    scoreCounts:    { [points: number]: number },
    maxPointVoters: string[]
  }[] = [];

  // Which entry in lastRoundVotes is currently being revealed.
  revealIndex = 0;

  // Whether all points have been revealed.
  revealComplete = false;

  // Names of contestants revealed so far — for row highlighting.
  revealedContestants: Set<string> = new Set();

  // Throttle clicks to prevent double-reveals.
  lastRevealClick = 0;

  // Whether this is a final results snapshot (no reveal sequence).
  isFinalSnapshot = false;

  // Final standings for a final results snapshot.
  finalContestants: any[] = [];

  // =====================================================
  // INITIALISATION
  // =====================================================

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error   = 'Invalid snapshot link.';
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }

    try {
      const docRef  = doc(db, 'snapshots', id);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        this.error   = 'This snapshot does not exist or has been deleted.';
        this.loading = false;
        return;
      }

      const data = docSnap.data();

      // Check if this is a final results snapshot.
      if (data['type'] === 'final') {
        this.isFinalSnapshot  = true;
        this.finalContestants = data['contestants'] || [];
        this.contestTitle     = data['contestTitle'] || '';
        this.loading          = false;
        this.cdr.detectChanges();
        return;
      }

      this.contestTitle      = data['contestTitle'] || '';
      this.voter             = data['voter'] || '';
      this.maxPointValue     = data['maxPointValue'] || 0;
      this.preRoundSnapshot  = data['preRoundSnapshot'] || [];
      this.lastRoundVotes    = data['lastRoundVotes'] || [];

      // Initialise displayContestants from the pre-round snapshot, sorted.
      this.displayContestants = this.preRoundSnapshot.map(c => ({
        ...c,
        scoreCounts:    { ...c.scoreCounts },
        maxPointVoters: [...(c.maxPointVoters || [])]
      }));
      this.sortDisplayContestants();

    } catch (err) {
      console.error('Failed to load snapshot:', err);
      this.error = 'Failed to load snapshot. Please try again.';
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  // =====================================================
  // REVEAL METHODS
  // =====================================================

  // Reveals the next point in the sequence.
  nextReveal() {
    const now = Date.now();
    if (now - this.lastRevealClick < 700) return;
    this.lastRevealClick = now;

    const current = this.lastRoundVotes[this.revealIndex];
    const d = this.displayContestants.find(d => d.name === current.contestant);

    if (d) {
      d.points += current.points;
      d.scoreCounts[current.points] = (d.scoreCounts[current.points] ?? 0) + 1;
      if (current.points === this.maxPointValue) {
        d.maxPointVoters = [...d.maxPointVoters, this.voter];
      }
    }

    this.revealedContestants.add(current.contestant);
    this.animateSort();

    setTimeout(() => {
      if (this.revealIndex < this.lastRoundVotes.length - 1) {
        this.revealIndex++;
      }
    }, 700);
  }

  animateSort() {
    const rows   = document.querySelectorAll('.score-row');
    const before = new Map<string, number>();

    rows.forEach(row => {
      const name = (row as HTMLElement).dataset['name'];
      if (name) before.set(name, row.getBoundingClientRect().top);
    });

    this.sortDisplayContestants();
    this.cdr.detectChanges();

    setTimeout(() => {
      const rowsAfter = document.querySelectorAll('.score-row');
      rowsAfter.forEach(row => {
        const el     = row as HTMLElement;
        const name   = el.dataset['name'];
        if (!name) return;
        const oldTop = before.get(name);
        const newTop = el.getBoundingClientRect().top;
        if (oldTop === undefined) return;
        const delta  = oldTop - newTop;
        if (delta === 0) return;

        el.style.transition = 'none';
        el.style.transform  = `translateY(${delta}px)`;

        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          el.style.transform  = 'translateY(0)';
        });
      });
    }, 0);
  }

  // =====================================================
  // SORTING
  // =====================================================

  sortDisplayContestants() {
    this.displayContestants.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      // Tiebreaker: compare scoreCounts from highest point value down.
      const allPoints = Object.keys({ ...a.scoreCounts, ...b.scoreCounts })
        .map(Number)
        .sort((x, y) => y - x);
      for (const pts of allPoints) {
        const aCount = a.scoreCounts[pts] ?? 0;
        const bCount = b.scoreCounts[pts] ?? 0;
        if (bCount !== aCount) return bCount - aCount;
      }
      return 0;
    });
  }

  // =====================================================
  // UTILITY
  // =====================================================

  // Returns tooltip string for the max point voters dot column.
  getMaxPointVotersTooltip(voters: string[]): string {
    if (!voters || voters.length === 0) return '';
    return voters.join(', ');
  }

  // Exports the current scoreboard state to an Excel (.xlsx) file.
  exportToExcel() {
    const contestants = this.isFinalSnapshot ? this.finalContestants : this.displayContestants;
    const rows = contestants.map((c: any, i: number) => ({
      'Rank':                i + 1,
      'Country':             c.country.replace(/[^\p{L}\p{N} ]/gu, '').trim(),
      'Participant':         c.name,
      'Artist':              c.artist,
      'Song':                c.song,
      'Max Points Received': c.maxPointVoters?.length ?? 0,
      'Total Points':        c.points
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Standings');

    const filename = this.isFinalSnapshot
    ? `${this.contestTitle || 'Contest'} Final Results.xlsx`
    : `${this.contestTitle || 'Contest'} Scoreboard ${this.voter}'s Votes.xlsx`;
    XLSX.writeFile(workbook, filename);
  }

  // trackBy for the scoreboard *ngFor.
  trackByName(index: number, contestant: { name: string }): string {
    return contestant.name;
  }

}
