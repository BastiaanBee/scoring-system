import { Component, OnInit, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { CdkDragDrop, moveItemInArray, DragDropModule } from '@angular/cdk/drag-drop';
import * as XLSX from 'xlsx';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { collection, addDoc } from 'firebase/firestore';
import { db } from './firebase.config';

@Component({
  selector: 'app-root',
  imports: [FormsModule, CommonModule, DragDropModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  encapsulation: ViewEncapsulation.None
})

export class App implements OnInit {

  constructor(private router: Router, private cdr: ChangeDetectorRef) {}

  goHome() {
    this.router.navigate(['/']);
  }

  lastRevealClick = 0;

  // =====================================================
  // DEV MODE
  // devMode:            skips setup and loads dummy data.
  // devModeContestOver: also skips straight to the
  //                     Contest Over screen for testing.
  // Set both to false for normal use.
  // =====================================================

  devMode            = false;
  devModeContestOver = false;

  // =====================================================
  // SETUP PAGE STATE
  // =====================================================

  // Whether setup is complete and the contest page is shown.
  setupComplete = this.devMode;

  // Whether a saved contest state exists in localStorage.
  hasSavedState = false;

  // Whether a finished contest exists in localStorage.
  hasFinishedContest = false;

  // Whether the previous contest overlay is shown.
  showPreviousContest = false;

  // Whether the save confirmation message is shown.
  resultsSaved = false;

  // The loaded previous contest data.
  previousContest: any = null;

  // Contest title entered by the host, shown in the header.
  contestTitle = this.devMode ? 'MU Worldvision Song Contest 47' : '';

  // Full country list loaded from REST Countries API + custom extras.
  countries: { name: string, flag: string }[] = [];

  // Form fields for adding a new contestant.
  newCountry = '';
  newName    = '';
  newArtist  = '';
  newSong    = '';

  // Index of the contestant currently being edited, or -1 if not editing.
  editingIndex = -1;

  // =====================================================
  // SCORING SYSTEM
  // scoringPreset:     active preset ('eurovision', 'formula1', 'custom').
  // scoringPresets:    built-in presets stored lowest to highest.
  // customPointsCount: how many positions the host wants.
  // customPoints:      the actual point values per position.
  // availablePoints:   computed getter — drives the voting panel,
  //                    reveal, tiebreaker, and minimum count check.
  // pointsDescending:  availablePoints reversed for tiebreaker.
  // =====================================================

  scoringPreset     = 'eurovision';
  customPointsCount = '';
  customPoints: (number | null)[] = [];

  scoringPresets: { [key: string]: number[] } = {
    eurovision: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
    formula1:   [1, 2, 4, 6, 8, 10, 12, 15, 18, 25],
  };

  get availablePoints(): number[] {
    if (this.scoringPreset === 'custom') {
      return [...this.customPoints]
        .filter((p): p is number => p !== null && p > 0)
        .sort((a, b) => a - b);
    }
    return this.scoringPresets[this.scoringPreset] ?? this.scoringPresets['eurovision'];
  }

  // Used by the tiebreaker: compare highest point value first.
  get pointsDescending(): number[] {
    return [...this.availablePoints].reverse();
  }

  // The maximum point value in the current scoring system.
  // Used to determine which votes count as "max points" for the dot column.
  get maxPointValue(): number {
    const pts = this.availablePoints;
    return pts.length > 0 ? pts[pts.length - 1] : 0;
  }

  // Minimum contestants = point positions + 1
  // (+1 because a contestant cannot vote for themselves.)
  get minContestants(): number {
    if (this.scoringPreset === 'custom') {
      return Number(this.customPointsCount) + 1;
    }
    return this.availablePoints.length + 1;
  }

  // Whether all custom point values have been filled in.
  get customPointsValid(): boolean {
    if (this.scoringPreset !== 'custom') return true;
    if (!this.customPointsCount || this.customPoints.length === 0) return false;
    return this.customPoints.every(p => p !== null && p > 0);
  }

  // Called when the host switches scoring preset.
  onScoringPresetChange() {
    this.customPointsCount = '';
    this.customPoints      = [];
  }

  // Called when the host confirms the custom point position count.
  // Capped at 20 positions.
  onCustomCountChange() {
    const count = Math.min(Number(this.customPointsCount ?? 0), 20);
    if (!count || count < 1) {
      this.customPoints = [];
      return;
    }
    const current     = this.customPoints;
    this.customPoints = Array.from({ length: count }, (_, i) => current[i] ?? null);
  }

  // =====================================================
  // CONTESTANTS
  //
  // TWO-ARRAY SYSTEM:
  //
  // contestants[] — SOURCE OF TRUTH.
  //   Points are awarded here once in submitVotes().
  //   Never modified during the reveal.
  //   Used for all logic and the Contest Over screen.
  //
  // displayContestants[] — WHAT THE SCOREBOARD SHOWS.
  //   Reset to preRoundSnapshot[] at the start of each reveal.
  //   Updated one point at a time during nextReveal().
  //   Synced back to contestants[] when the reveal completes.
  //
  // preRoundSnapshot[] — STATE BEFORE THIS ROUND'S POINTS.
  //   Saved in submitVotes() before points are awarded.
  //   Used by openReveal() to reset displayContestants[]
  //   to the correct pre-reveal state every time, cleanly.
  //   This eliminates any subtraction logic or state confusion.
  //
  // maxPointVoters[] — WHO AWARDED THE MAX POINTS.
  //   A list of voter names who gave this contestant the
  //   maximum point value in the current scoring system.
  //   Drives the gold dot column on the scoreboard.
  // =====================================================

  contestants: {
    name:           string,
    country:        string,
    artist:         string,
    song:           string,
    points:         number,
    scoreCounts:    { [points: number]: number },
    maxPointVoters: string[]
  }[] = this.devMode ? [
    { name: 'Vreven',     country: '🇳🇱 Netherlands',  artist: 'Scram C Baby',            song: 'Elephant',                         points: 12, scoreCounts: { 12: 1 }, maxPointVoters: ['Aron24'] },
    { name: 'Whitewolf',  country: '🇩🇪 Germany',      artist: 'Orden Ogan',               song: 'Fields of Sorrow',                 points: 8,  scoreCounts: { 8: 1  }, maxPointVoters: []        },
    { name: 'Aron24',     country: '🇸🇪 Sweden',       artist: 'Mondo',                    song: 'Feeling Myself',                   points: 5,  scoreCounts: { 5: 1  }, maxPointVoters: []        },
    { name: 'Keko',       country: '🇫🇷 France',       artist: 'Tiger Finkel',             song: 'Brighter Days',                    points: 3,  scoreCounts: { 3: 1  }, maxPointVoters: []        },
    { name: 'Urbeto',     country: '🇯🇵 Japan',        artist: 'The Fin',                  song: 'Night Time',                       points: 0,  scoreCounts: {},         maxPointVoters: []        },
    { name: 'Platina32',  country: '🇧🇪 Belgium',      artist: 'Melanie de Biasio',        song: 'No Deal',                          points: 0,  scoreCounts: {},         maxPointVoters: []        },
    { name: 'Copywriter', country: '🇦🇹 Austria',      artist: 'Eela Craig',               song: 'Carry On',                         points: 0,  scoreCounts: {},         maxPointVoters: []        },
    { name: 'Satyr',      country: '🇳🇴 Norway',       artist: 'Ulver',                    song: 'Machine Guns and Peacock Feathers', points: 0,  scoreCounts: {},         maxPointVoters: []        },
    { name: 'Nasje',      country: '🇿🇦 South Africa', artist: 'Roan Ash',                 song: 'Poets and Silhouettes',            points: 0,  scoreCounts: {},         maxPointVoters: []        },
    { name: 'Tim\'',      country: '🇮🇪 Ireland',      artist: 'Sprints',                  song: 'Literary Mind',                    points: 0,  scoreCounts: {},         maxPointVoters: []        },
    { name: 'Djurovski',  country: '🇨🇱 Chile',        artist: 'De Saloon',                song: 'Me Vuelves A Herir',               points: 0,  scoreCounts: {},         maxPointVoters: []        },
  ] : [];

  // What the scoreboard shows — updated during the reveal.
  displayContestants: {
    name:           string,
    country:        string,
    artist:         string,
    song:           string,
    points:         number,
    scoreCounts:    { [points: number]: number },
    maxPointVoters: string[]
  }[] = this.contestants.map(c => ({
    ...c,
    scoreCounts:    { ...c.scoreCounts },
    maxPointVoters: [...c.maxPointVoters]
  }));

  // Snapshot of contestants[] taken BEFORE points are awarded.
  // Used to reset displayContestants[] at the start of the reveal.
  preRoundSnapshot: {
    name:           string,
    country:        string,
    artist:         string,
    song:           string,
    points:         number,
    scoreCounts:    { [points: number]: number },
    maxPointVoters: string[]
  }[] = [];

  // =====================================================
  // VOTING STATE
  // =====================================================

  // Point values used in the current round.
  usedPoints: number[] = [];

  // Index into voterOrder — which voter's turn it is.
  currentVoterIndex = 0;

  // Current round number shown in the header.
  get currentRound(): number {
    return this.currentVoterIndex + 1;
  }

  // Total rounds — falls back to contestants.length if
  // voterOrder isn't populated yet (e.g. on first render).
  get totalRounds(): number {
    return this.voterOrder.length > 0
      ? this.voterOrder.length
      : this.contestants.length;
  }

  // Full log of every vote cast across all rounds.
  votes: { voter: string; contestant: string; points: number }[] = [];

  // Votes being built in the current round (points → contestant name).
  currentRoundVotes: { [points: number]: string } = {};

  // Error message shown when a voting rule is violated.
  errorMessage = '';

  // Name of the last voter to submit, shown in the voter bar.
  lastSubmittedVoter = 'none';

  canUndo = false;

  // Whether a snapshot is currently being generated.
  snapshotGenerating = false;
  snapshotGenerated = false;
  finalSnapshotGenerated = false;
  previousSnapshotGenerated = false;

  // Error message shown if snapshot generation fails.
  snapshotError = '';

  // Alphabetical voter order, locked in at contest start.
  // Never changes — scoreboard sorting cannot affect voting order.
  voterOrder: string[] = [];

  // =====================================================
  // REVEAL STATE
  // =====================================================

  // The round's votes sorted lowest to highest.
  // Drives the reveal bar display only — no point logic here.
  lastRoundVotes: { contestant: string; points: number }[] = [];

  // Whether the reveal bar is visible.
  showReveal = false;

  // Which entry in lastRoundVotes is currently being revealed.
  revealIndex = 0;

  // Names of contestants who have received points so far in this reveal.
  revealedContestants: Set<string> = new Set();

  // The voter whose round is currently being revealed.
  revealVoter = '';

  // =====================================================
  // CONTEST OVER STATE
  // =====================================================

  // Set to true after the last voter's reveal completes.
  contestOver = this.devModeContestOver;

  // Whether the voter who just submitted was the last one.
  // Set in submitVotes() before nextVoter() increments the index,
  // because nextVoter() never goes past the last index.
  isLastRound = false;

  // =====================================================
  // INITIALISATION
  // =====================================================

  ngOnInit() {
    // Check for saved state before the fetch so banners appear immediately.
    if (!this.devMode) {
      this.hasSavedState      = localStorage.getItem('contestState') !== null;
      this.hasFinishedContest = localStorage.getItem('finishedContest') !== null;
    }

    fetch('https://restcountries.com/v3.1/all?fields=name,flag')
      .then(res => res.json())
      .then(data => {
        const fetched = data.map((c: any) => ({
          name: c.name.common,
          flag: c.flag
        }));

        // Non-sovereign territories not in the REST Countries API.
        const extras = [
          { name: 'England',          flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
          { name: 'Scotland',         flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
          { name: 'Wales',            flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
          { name: 'Northern Ireland', flag: '🇬🇧' },
        ];

        this.countries = [...fetched, ...extras]
          .sort((a, b) => a.name.localeCompare(b.name));

        // DevMode: lock voter order and sync display array.
        if (this.devMode) {
          this.lockVoterOrder();
          if (this.devModeContestOver) {
            this.contestOver       = true;
            this.currentVoterIndex = this.voterOrder.length;
          }
        }
      });
  }

  // =====================================================
  // SETUP METHODS
  // =====================================================

  // Handles drag-and-drop reordering of the contestant list on the setup page.
  // moveItemInArray is from the Angular CDK and reorders in place.
  dropContestant(event: CdkDragDrop<any[]>) {
    moveItemInArray(this.contestants, event.previousIndex, event.currentIndex);
    if (!this.devMode) this.saveState();
  }

  // Sorts the contestant list alphabetically by name.
  sortContestantsAlphabetically() {
    this.contestants.sort((a, b) => {
      const nameA = a.country.replace(/[^\p{L}\p{N} ]/gu, '').trim();
      const nameB = b.country.replace(/[^\p{L}\p{N} ]/gu, '').trim();
      return nameA.localeCompare(nameB);
    });
    if (!this.devMode) this.saveState();
  }

  // Shuffles the contestant list randomly using Fisher-Yates algorithm.
  shuffleContestants() {
    for (let i = this.contestants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.contestants[i], this.contestants[j]] = [this.contestants[j], this.contestants[i]];
    }
    if (!this.devMode) this.saveState();
  }

  // Populates the form fields with the selected contestant's data for editing.
  editContestant(index: number) {
    const c = this.contestants[index];
    this.editingIndex = index;
    this.newCountry   = c.country;
    this.newName      = c.name;
    this.newArtist    = c.artist;
    this.newSong      = c.song;
  }

  // Saves the edited contestant back into the array at the same position.
  saveEditedContestant() {
    if (!this.newCountry || !this.newName || !this.newArtist || !this.newSong) return;

    // Check for duplicate country, but allow the contestant's own current country.
    const duplicate = this.contestants.some((c, i) =>
      c.country === this.newCountry && i !== this.editingIndex
    );
    if (duplicate) {
      alert('This country has already been added.');
      return;
    }

    this.contestants[this.editingIndex] = {
      ...this.contestants[this.editingIndex],
      country: this.newCountry,
      name:    this.newName,
      artist:  this.newArtist,
      song:    this.newSong,
    };

    // Reset the form back to add mode.
    this.editingIndex = -1;
    this.newCountry   = '';
    this.newName      = '';
    this.newArtist    = '';
    this.newSong      = '';
    if (!this.devMode) this.saveState();
  }

  // Adds a contestant. Validates all fields and no duplicate country.
  addContestant() {
    if (!this.newCountry || !this.newName || !this.newArtist || !this.newSong) return;

    const alreadyUsed = this.contestants.some(c => c.country === this.newCountry);
    if (alreadyUsed) {
      alert('This country has already been added.');
      return;
    }

    this.contestants.push({
      name:           this.newName,
      country:        this.newCountry,
      artist:         this.newArtist,
      song:           this.newSong,
      points:         0,
      scoreCounts:    {},
      maxPointVoters: []
    });

    this.newCountry = '';
    this.newName    = '';
    this.newArtist  = '';
    this.newSong    = '';
    if (!this.devMode) this.saveState();
  }

  // Returns true if a country is already in the contestant list.
  // Used to grey out already-chosen countries in the dropdown.
  isCountryTaken(value: string): boolean {
    return this.contestants.some(c => c.country === value);
  }

  // Locks voter order alphabetically. Called once on "Start Contest".
  // Also initialises displayContestants[] to match contestants[].
  lockVoterOrder() {
    this.voterOrder = this.contestants.map(c => c.name);

    this.displayContestants = this.contestants.map(c => ({
      ...c,
      scoreCounts:    { ...c.scoreCounts },
      maxPointVoters: [...c.maxPointVoters]
    }));
    if (!this.devMode) this.saveState();
  }

  // Called by the Start Contest button.
  // Locks voter order, marks setup as complete, and saves state.
  startContest() {
    this.lockVoterOrder();
    this.setupComplete = true;
    if (!this.devMode) this.saveState();
  }

  // =====================================================
  // VOTING METHODS
  // =====================================================

  // Contestants sorted alphabetically — used in voting dropdowns.
  get sortedContestants() {
    return [...this.contestants].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  // The contestant currently voting, from the locked voter order.
  get currentVoter(): string {
    return this.voterOrder[this.currentVoterIndex] ?? '';
  }

  // Records a vote assignment for a given point value.
  setVote(points: number, contestantName: string) {
    this.currentRoundVotes[points] = contestantName;
  }

  // How many point slots are filled this round.
  // Drives the progress bar and Submit button state.
  get selectedVoteCount(): number {
    return Object.keys(this.currentRoundVotes).length;
  }

  // Advances to the next voter. Deliberately does NOT go past
  // the last index — that's why isLastRound exists.
  nextVoter() {
    this.usedPoints = [];
    if (this.currentVoterIndex < this.voterOrder.length - 1) {
      this.currentVoterIndex++;
    }
  }

  // Validates and submits votes.
  //
  // KEY DESIGN:
  // 1. Save preRoundSnapshot[] BEFORE awarding points —
  //    this is the clean pre-round state used by openReveal().
  // 2. Award points to contestants[] immediately and permanently.
  // 3. Never touch contestants[] again until next submitVotes().
  submitVotes() {
    this.errorMessage = '';

    const selectedContestants = Object.values(this.currentRoundVotes);

    // Rule: cannot vote for yourself.
    if (selectedContestants.includes(this.currentVoter)) {
      this.errorMessage = 'You cannot vote for yourself.';
      return;
    }

    // Rule: cannot give points to the same contestant twice.
    const uniqueContestants = new Set(selectedContestants);
    if (uniqueContestants.size !== selectedContestants.length) {
      this.errorMessage = 'You assigned points to the same participant more than once.';
      return;
    }

    // Build the round votes list, sorted lowest to highest for the reveal.
    this.lastRoundVotes = Object.entries(this.currentRoundVotes)
      .map(([points, contestant]) => ({ contestant, points: Number(points) }))
      .sort((a, b) => a.points - b.points);

    // STEP 1: Save pre-round snapshot BEFORE awarding any points.
    // openReveal() uses this to reset displayContestants[] cleanly.
    this.preRoundSnapshot = this.contestants.map(c => ({
      ...c,
      scoreCounts:    { ...c.scoreCounts },
      maxPointVoters: [...c.maxPointVoters]
    }));

    // STEP 2: Award points to contestants[] — the source of truth.
    // This happens exactly once per round, right here.
    for (const { points, contestant: name } of this.lastRoundVotes) {
      const c = this.contestants.find(c => c.name === name);
      if (c) {
        c.points += points;
        c.scoreCounts[points] = (c.scoreCounts[points] ?? 0) + 1;
        // If this is the maximum point value, record who awarded it.
        if (points === this.maxPointValue) {
          c.maxPointVoters.push(this.currentVoter);
        }
        this.votes.push({ voter: this.currentVoter, contestant: name, points });
      }
    }

    // Sort contestants[] to reflect the new standings.
    this.sortContestants();

    // Capture whether this is the last voter before advancing.
    this.isLastRound = this.currentVoterIndex === this.voterOrder.length - 1;

    this.currentRoundVotes  = {};
    this.usedPoints         = [];
    this.lastSubmittedVoter = this.currentVoter;

    // Close any previous reveal bar.
    this.showReveal  = false;
    this.revealIndex = 0;

    // Sync display to truth before starting new reveal.
    this.displayContestants = this.contestants.map(c => ({
      ...c,
      scoreCounts:    { ...c.scoreCounts },
      maxPointVoters: [...c.maxPointVoters]
    }));

    this.nextVoter();
    this.canUndo = true;
    this.snapshotGenerated = false;
    this.saveState();
  }

  // =====================================================
  // SORTING
  // Primary: total points, highest first.
  // Tiebreaker: compare how many times each contestant
  // received each point value, from highest to lowest.
  // =====================================================

  sortContestants() {
    this.contestants.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      for (const pts of this.pointsDescending) {
        const aCount = a.scoreCounts[pts] ?? 0;
        const bCount = b.scoreCounts[pts] ?? 0;
        if (bCount !== aCount) return bCount - aCount;
      }
      return 0;
    });
  }

  // Same sort logic applied to displayContestants[].
  sortDisplayContestants() {
    this.displayContestants.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      for (const pts of this.pointsDescending) {
        const aCount = a.scoreCounts[pts] ?? 0;
        const bCount = b.scoreCounts[pts] ?? 0;
        if (bCount !== aCount) return bCount - aCount;
      }
      return 0;
    });
  }

  // =====================================================
  // ANIMATION
  // FLIP technique applied to displayContestants[].
  // Records positions before sort, sorts instantly,
  // then animates rows from old to new positions.
  // =====================================================

  animateSort() {
    const rows   = document.querySelectorAll('.score-row');
    const before = new Map<string, number>();

    rows.forEach(row => {
      const name = (row as HTMLElement).dataset['name'];
      if (name) before.set(name, row.getBoundingClientRect().top);
    });

    // Sort the display array — NOT contestants[].
    this.sortDisplayContestants();

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
  // REVEAL METHODS
  // =====================================================

  // Opens the reveal bar.
  // Resets displayContestants[] to preRoundSnapshot[] —
  // the state from before this round's points were awarded.
  // This is clean and reliable: no subtraction, no flags,
  // just a direct copy of the pre-round state.
  // Can be called multiple times safely — always resets correctly.
  openReveal() {
    // Reset displayContestants to the pre-round state.
    this.displayContestants = this.preRoundSnapshot.map(c => ({
      ...c,
      scoreCounts:    { ...c.scoreCounts },
      maxPointVoters: [...c.maxPointVoters]
    }));

    // Sort to reflect pre-round standings.
    this.sortDisplayContestants();

    this.revealIndex         = 0;
    this.revealedContestants = new Set();
    this.showReveal          = true;
    this.lastRevealClick     = 0;
    this.revealVoter         = this.lastSubmittedVoter;
  }

  // Steps through the reveal one point at a time.
  // Only modifies displayContestants[] — never contestants[].
  // contestants[] was updated once in submitVotes() and is the truth.
  nextReveal() {
    const now = Date.now();
    if (now - this.lastRevealClick < 700) return;
    this.lastRevealClick = now;

    const current = this.lastRoundVotes[this.revealIndex];

    const d = this.displayContestants.find(d => d.name === current.contestant);
    if (d) {
      d.points += current.points;
      d.scoreCounts[current.points] = (d.scoreCounts[current.points] ?? 0) + 1;
      // Update maxPointVoters live during reveal so dot column animates.
      if (current.points === this.maxPointValue) {
        d.maxPointVoters = [...d.maxPointVoters, this.revealVoter];
      }
    }

    this.animateSort();
    this.revealedContestants.add(current.contestant);

    setTimeout(() => {
      if (this.revealIndex < this.lastRoundVotes.length - 1) {
        this.revealIndex++;
      } else if (this.isLastRound) {
        // Last round, last point revealed — contest is over.
        this.revealVoter         = '';
        this.revealedContestants = new Set();
      }
    }, 700);
  }

  // Closes the reveal bar and clears all reveal state.
  endReveal() {
    this.showReveal          = false;
    this.revealVoter         = '';
    this.revealedContestants = new Set();
  }

  // Undoes the last submitted round.
  // Restores contestants[] and displayContestants[] to preRoundSnapshot[],
  // steps back the voter index, and clears all round state.
  undoLastRound() {
    if (this.preRoundSnapshot.length === 0) return;

    // Restore source of truth and display array to pre-round state.
    this.contestants = this.preRoundSnapshot.map(c => ({
      ...c,
      scoreCounts:    { ...c.scoreCounts },
      maxPointVoters: [...c.maxPointVoters]
    }));
    this.displayContestants = this.preRoundSnapshot.map(c => ({
      ...c,
      scoreCounts:    { ...c.scoreCounts },
      maxPointVoters: [...c.maxPointVoters]
    }));

    // Remove votes cast in the last round from the vote log.
    const roundVoteCount = this.lastRoundVotes.length;
    this.votes.splice(this.votes.length - roundVoteCount, roundVoteCount);

    // Step back the voter index.
    if (this.currentVoterIndex > 0) {
      this.currentVoterIndex--;
    }

    // Clear all round state.
    this.lastRoundVotes     = [];
    this.lastSubmittedVoter = 'none';
    this.currentRoundVotes  = {};
    this.preRoundSnapshot   = [];
    this.isLastRound        = false;

    // Close reveal bar if open.
    this.showReveal          = false;
    this.revealVoter         = '';
    this.revealedContestants = new Set();

    // Re-sort the scoreboard.
    this.sortContestants();
    this.sortDisplayContestants();
    this.canUndo = false;
    this.snapshotGenerated = false;
    this.saveState();
  }

  // =====================================================
  // UTILITY
  // =====================================================

  // Returns true if this contestant is the current voter.
  isCurrentVoter(name: string): boolean {
    return name === this.revealVoter;
  }

  // Returns true if this contestant has already voted in a previous round.
  hasAlreadyVoted(name: string): boolean {
    return this.voterOrder.indexOf(name) < this.currentVoterIndex;
  }

  // Returns true only if this contestant has already been revealed this round.
  hasReceivedPointsInReveal(name: string): boolean {
    return this.revealedContestants.has(name);
  }

  // Returns the tooltip string for the max point voters dot column.
  // Lists all voters who awarded the maximum point value to this contestant.
  getMaxPointVotersTooltip(voters: string[]): string {
    if (!voters || voters.length === 0) return '';
    return voters.join(', ');
  }

  // =====================================================
  // LOCAL STORAGE
  // Saves and restores full contest state so the host
  // can close the browser and resume later.
  // =====================================================

  // Saves the current contest state to localStorage.
  saveState() {
    const state = {
      contestTitle:       this.contestTitle,
      scoringPreset:      this.scoringPreset,
      customPointsCount:  this.customPointsCount,
      customPoints:       this.customPoints,
      contestants:        this.contestants,
      displayContestants: this.displayContestants,
      preRoundSnapshot:   this.preRoundSnapshot,
      voterOrder:         this.voterOrder,
      currentVoterIndex:  this.currentVoterIndex,
      votes:              this.votes,
      lastRoundVotes:     this.lastRoundVotes,
      lastSubmittedVoter: this.lastSubmittedVoter,
      setupComplete:      this.setupComplete,
      contestOver:        this.contestOver,
      isLastRound:        this.isLastRound,
      canUndo:            this.canUndo,
    };
    localStorage.setItem('contestState', JSON.stringify(state));
  }

  // Restores contest state from localStorage.
  // Returns true if a saved state was found and loaded.
  loadState(): boolean {
    const raw = localStorage.getItem('contestState');
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      this.contestTitle       = s.contestTitle;
      this.scoringPreset      = s.scoringPreset;
      this.customPointsCount  = s.customPointsCount;
      this.customPoints       = s.customPoints;
      this.contestants        = s.contestants;
      this.displayContestants = s.displayContestants;
      this.preRoundSnapshot   = s.preRoundSnapshot;
      this.voterOrder         = s.voterOrder;
      this.currentVoterIndex  = s.currentVoterIndex;
      this.votes              = s.votes;
      this.lastRoundVotes     = s.lastRoundVotes;
      this.lastSubmittedVoter = s.lastSubmittedVoter;
      this.setupComplete      = s.setupComplete;
      this.contestOver        = s.contestOver;
      this.isLastRound        = s.isLastRound;
      this.canUndo            = s.canUndo;
      return true;
    } catch {
      return false;
    }
  }

  // Clears the saved contest state from localStorage.
  clearState() {
    localStorage.removeItem('contestState');
  }

  // Saves the finished contest results to a separate localStorage slot.
  saveFinishedContest() {
    const data = {
      contestTitle: this.contestTitle,
      contestants:  this.contestants
    };
    localStorage.setItem('finishedContest', JSON.stringify(data));
    this.hasFinishedContest = true;
    this.resultsSaved       = true;
    setTimeout(() => this.resultsSaved = false, 3000);
  }

  // Generates a snapshot of the current round's reveal sequence and
  // writes it to Firestore. Opens the snapshot page in a new tab.
  async generateSnapshot() {
    this.snapshotGenerating = true;
    this.snapshotError      = '';
    try {
      const snapshotData = {
        contestTitle:    this.contestTitle,
        voter:           this.lastSubmittedVoter,
        voterOrder:      this.voterOrder,
        currentVoterIndex: this.currentVoterIndex,
        preRoundSnapshot: this.preRoundSnapshot,
        lastRoundVotes:  this.lastRoundVotes,
        scoringPreset:   this.scoringPreset,
        maxPointValue:   this.maxPointValue,
        createdAt:       new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'snapshots'), snapshotData);
      const url    = `${window.location.origin}/snapshot/${docRef.id}`;
      window.open(url, '_blank');
      this.snapshotGenerated = true;
    } catch (err) {
      console.error('Snapshot generation failed:', err);
      this.snapshotError = 'Failed to generate snapshot. Please try again.';
    } finally {
      this.snapshotGenerating = false;
      this.cdr.detectChanges();
    }
  }

  // Generates a snapshot of the final results and opens it in a new tab.
  async generateFinalSnapshot() {
    this.snapshotGenerating = true;
    this.snapshotError      = '';
    try {
      const snapshotData = {
        type:          'final',
        contestTitle:  this.contestTitle,
        contestants:   this.contestants,
        createdAt:     new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'snapshots'), snapshotData);
      const url    = `${window.location.origin}/snapshot/${docRef.id}`;
      window.open(url, '_blank');
      this.finalSnapshotGenerated = true;
    } catch (err) {
      console.error('Final snapshot generation failed:', err);
      this.snapshotError = 'Failed to generate snapshot. Please try again.';
    } finally {
      this.snapshotGenerating = false;
      this.cdr.detectChanges();
    }
  }

  // Generates a shareable final results snapshot from the previous contest data.
  async generatePreviousContestSnapshot() {
    this.snapshotGenerating = true;
    this.snapshotError      = '';
    try {
      const snapshotData = {
        type:         'final',
        contestTitle: this.previousContest?.contestTitle || '',
        contestants:  this.previousContest?.contestants || [],
        createdAt:    new Date().toISOString()
      };
      const docRef = await addDoc(collection(db, 'snapshots'), snapshotData);
      const url    = `${window.location.origin}/snapshot/${docRef.id}`;
      window.open(url, '_blank');
      this.previousSnapshotGenerated = true;
    } catch (err) {
      console.error('Snapshot generation failed:', err);
      this.snapshotError = 'Failed to generate snapshot. Please try again.';
    } finally {
      this.snapshotGenerating = false;
      this.cdr.detectChanges();
    }
  }

  // Ends the contest and shows the final results screen.
  // Called by the host after the last round has been submitted.
  // Shows a confirmation dialog before proceeding.
  endContest() {
    const confirmed = window.confirm('End the contest and show the final results page?');
    if (!confirmed) return;
    this.contestOver = true;
    this.clearState();
  }

  // Exports the final contest standings to an Excel (.xlsx) file.
  // Each contestant gets a row with their rank, country, name, artist,
  // song, total points, and how many times they received the max point value.
  exportToExcel(contestants: any[], title: string) {
    const rows = contestants.map((c, i) => ({
      'Rank':       i + 1,
      'Country':    c.country.replace(/[^\p{L}\p{N} ]/gu, '').trim(),
      'Participant': c.name,
      'Artist':     c.artist,
      'Song':       c.song,
      'Max Points Received': c.maxPointVoters?.length ?? 0,
      'Total Points': c.points
    }));

    const worksheet  = XLSX.utils.json_to_sheet(rows);
    const workbook   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');

    // Use the contest title as the filename, falling back to a default.
    const filename = (title || 'Contest Results').replace(/[^a-z0-9 ]/gi, '_') + '.xlsx';
    XLSX.writeFile(workbook, filename);
  }

  // Exports the current live scoreboard state to an Excel (.xlsx) file.
  // Used during the contest to save a mid-round snapshot of standings.
  exportLiveScoreboard() {
    const rows = this.displayContestants.map((c, i) => ({
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

    const filename = `${this.contestTitle || 'Contest'} Scoreboard Round ${this.currentRound}.xlsx`;
    XLSX.writeFile(workbook, filename);
  }

  // Returns to the setup page and resets all contest state.
  backToSetup() {
    this.contestOver        = false;
    this.setupComplete      = false;
    this.contestants        = [];
    this.displayContestants = [];
    this.voterOrder         = [];
    this.currentVoterIndex  = 0;
    this.votes              = [];
    this.lastRoundVotes     = [];
    this.lastSubmittedVoter = 'none';
    this.preRoundSnapshot   = [];
    this.contestTitle       = '';
    this.isLastRound        = false;
    this.canUndo            = false;
    this.clearState();
  }

  // Opens the previous contest overlay.
  viewPreviousContest() {
    const raw = localStorage.getItem('finishedContest');
    if (!raw) return;
    try {
      this.previousContest     = JSON.parse(raw);
      this.showPreviousContest = true;
      document.body.classList.add('overflow-hidden');
    } catch {
      console.error('Failed to load previous contest');
    }
  }

  // Closes the previous contest overlay.
  closePreviousContest() {
    this.showPreviousContest = false;
    document.body.classList.remove('overflow-hidden');
  }

  // Loads the participants from the previous finished contest into the
  // setup page with a clean scoreboard, so the host can start a new
  // contest with the same contestants without re-entering them.
  reuseParticipants() {
    if (!this.previousContest?.contestants) return;

    // Copy contestants, resetting all score data to zero.
    this.contestants = this.previousContest.contestants.map((c: any) => ({
      name:           c.name,
      country:        c.country,
      artist:         c.artist,
      song:           c.song,
      points:         0,
      scoreCounts:    {},
      maxPointVoters: []
    }));

    // Close the overlay and return to setup page.
    this.closePreviousContest();
    this.setupComplete       = false;
    this.contestOver         = false;
    this.voterOrder          = [];
    this.currentVoterIndex   = 0;
    this.votes               = [];
    this.lastRoundVotes      = [];
    this.lastSubmittedVoter  = 'none';
    this.preRoundSnapshot    = [];
    this.contestTitle        = '';
    this.isLastRound         = false;
    this.canUndo             = false;
    this.displayContestants  = [];

    if (!this.devMode) this.saveState();
  }

  // Resumes a saved contest — loads state and hides the banner.
  resumeContest() {
    this.loadState();
    this.hasSavedState = false;
  }

  // Discards the saved contest and starts fresh.
  discardSavedContest() {
    this.clearState();
    this.hasSavedState = false;
  }

  // trackBy for the scoreboard *ngFor — prevents DOM destruction
  // on re-sort, which is required for the FLIP animation.
  trackByName(index: number, contestant: { name: string }): string {
    return contestant.name;
  }

  // trackBy for the custom points *ngFor — prevents input
  // focus from being lost when the array updates.
  trackByIndex(index: number): number {
    return index;
  }

}