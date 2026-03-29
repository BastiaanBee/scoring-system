import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [FormsModule, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  encapsulation: ViewEncapsulation.None
})

export class App implements OnInit {

  lastRevealClick = 0;
  scoreSnapshot: { name: string, points: number, scoreCounts: { [points: number]: number } }[] = [];

  // =====================================================
  // DEV MODE
  // devMode:            skips setup and loads dummy data.
  // devModeContestOver: also skips straight to the
  //                     Contest Over screen for testing.
  // Set both to false for normal use.
  // =====================================================

  devMode            = true;
  devModeContestOver = false;

  // =====================================================
  // SETUP PAGE STATE
  // Variables used during the setup phase.
  // =====================================================

  // Whether setup is complete and the contest page is shown.
  // Set to true immediately if devMode is on.
  setupComplete = this.devMode;

  // Contest title entered by the host, shown in the header.
  contestTitle = this.devMode ? 'MU Worldvision Song Contest 47' : '';

  // Full country list, loaded from REST Countries API + custom extras.
  countries: { name: string, flag: string }[] = [];

  // Form fields for adding a new contestant during setup.
  newCountry = '';
  newName    = '';
  newArtist  = '';
  newSong    = '';

  // =====================================================
  // SCORING SYSTEM
  // scoringPreset:    which preset is active ('eurovision',
  //                   'formula1', or 'custom').
  // scoringPresets:   the built-in presets, stored lowest
  //                   to highest (reveal order).
  // customPointsCount: how many positions the host wants
  //                   in a custom scoring system.
  // customPoints:     the actual point values for each
  //                   custom position, entered by the host.
  //
  // availablePoints:  computed getter — returns the active
  //                   point values. Drives the voting panel,
  //                   the reveal, the tiebreaker, and the
  //                   minimum contestant count check.
  // pointsDescending: availablePoints reversed, used by
  //                   the tiebreaker sort.
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

  // Used by the tiebreaker: highest point value compared first.
  get pointsDescending(): number[] {
    return [...this.availablePoints].reverse();
  }

  // Minimum contestants needed = number of point positions + 1.
  // (+1 because a contestant cannot vote for themselves.)
  get minContestants(): number {
    return this.availablePoints.length + 1;
  }

  // Called when the host switches scoring preset.
  // Resets any custom values so they don't carry over.
  onScoringPresetChange() {
    this.customPointsCount = '';
    this.customPoints      = [];
  }

  // Called when the host confirms how many custom positions they want.
  // Builds the customPoints array, preserving any already-entered values.
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
  // The main contestant list.
  // Pre-loaded with dummy data if devMode is on,
  // otherwise starts empty and is filled during setup.
  //
  // scoreCounts: frequency map tracking how many times
  // each point value has been awarded to this contestant.
  // Example: { 12: 3, 10: 2 } = received 12pts 3 times,
  // 10pts twice. Used for tiebreaking.
  // =====================================================

  contestants: {
    name:        string,
    country:     string,
    artist:      string,
    song:        string,
    points:      number,
    scoreCounts: { [points: number]: number }
  }[] = this.devMode ? [
    { name: 'Vreven',     country: '🇳🇱 Netherlands', artist: 'Scram C Baby',            song: 'Elephant',                         points: 12, scoreCounts: { 12: 1 } },
    { name: 'Whitewolf',  country: '🇩🇪 Germany',     artist: 'Orden Ogan',               song: 'Fields of Sorrow',                 points: 8,  scoreCounts: { 8: 1  } },
    { name: 'Aron24',     country: '🇸🇪 Sweden',      artist: 'Mondo',                    song: 'Feeling Myself',                   points: 5,  scoreCounts: { 5: 1  } },
    { name: 'Keko',       country: '🇫🇷 France',      artist: 'Tiger Finkel',             song: 'Brighter Days',                    points: 3,  scoreCounts: { 3: 1  } },
    { name: 'Urbeto',     country: '🇯🇵 Japan',       artist: 'The Fin',                  song: 'Night Time',                       points: 0,  scoreCounts: {}        },
    { name: 'Platina32',  country: '🇧🇪 Belgium',     artist: 'Melanie de Biasio',        song: 'No Deal',                          points: 0,  scoreCounts: {}        },
    { name: 'Copywriter', country: '🇦🇹 Austria',     artist: 'Eela Craig',               song: 'Carry On',                         points: 0,  scoreCounts: {}        },
    { name: 'Satyr',      country: '🇳🇴 Norway',      artist: 'Ulver',                    song: 'Machine Guns and Peacock Feathers', points: 0,  scoreCounts: {}        },
    { name: 'Nasje',      country: '🇿🇦 South Africa',artist: 'Roan Ash',                 song: 'Poets and Silhouettes',            points: 0,  scoreCounts: {}        },
    { name: 'Tim\'',      country: '🇮🇪 Ireland',     artist: 'Sprints',                  song: 'Literary Mind',                    points: 0,  scoreCounts: {}        },
    { name: 'Djurovski',  country: '🇨🇱 Chile',       artist: 'De Saloon',                song: 'Me Vuelves A Herir',               points: 0,  scoreCounts: {}        },
  ] : [];

  // =====================================================
  // VOTING STATE
  // =====================================================

  // Point values used in the current round (tracks duplicates).
  usedPoints: number[] = [];

  // Index into voterOrder — which voter's turn it is.
  currentVoterIndex = 0;

  // Getter to decide what the current round number is.
  get currentRound(): number {
    return this.currentVoterIndex + 1;
  }

  // Getter to decide what the maximum numbers of rounds is.
  get totalRounds(): number {
    return this.voterOrder.length > 0 
      ? this.voterOrder.length 
      : this.contestants.length;
  }

  // Full log of every vote cast, across all rounds.
  votes: { voter: string; contestant: string; points: number }[] = [];

  // The votes being built in the current round (points → contestant name).
  currentRoundVotes: { [points: number]: string } = {};

  // Error message shown when a voting rule is violated.
  errorMessage = '';

  // Name of the last voter to submit, shown in the voter bar.
  lastSubmittedVoter = 'none';

  // Alphabetical voter order, locked in at contest start.
  // Never changes after lockVoterOrder() is called.
  // Ensures scoreboard re-sorting never affects voting order.
  voterOrder: string[] = [];

  // =====================================================
  // REVEAL STATE
  // =====================================================

  // The votes from the last submitted round, sorted lowest to highest.
  // Drives the reveal bar one point at a time.
  lastRoundVotes: { contestant: string; points: number }[] = [];

  // Whether the reveal bar is currently visible.
  showReveal = false;

  // Which point in lastRoundVotes is currently being revealed.
  revealIndex = 0;

  // =====================================================
  // CONTEST OVER STATE
  // =====================================================

  // Set to true after the last voter's reveal completes.
  // Shows the Contest Over screen.
  contestOver = this.devModeContestOver;

  // =====================================================
  // INITIALISATION
  // Runs once on app load.
  // Fetches countries from REST Countries API,
  // appends custom non-sovereign territories,
  // and sets up devMode state if applicable.
  // =====================================================

  ngOnInit() {
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

        // DevMode setup: lock voter order from dummy data.
        if (this.devMode) {
          this.lockVoterOrder();

          // If devModeContestOver, jump straight to the end state.
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

  // Adds a contestant to the list.
  // Validates all fields are filled and country isn't already used.
  addContestant() {
    if (!this.newCountry || !this.newName || !this.newArtist || !this.newSong) return;

    const alreadyUsed = this.contestants.some(c => c.country === this.newCountry);
    if (alreadyUsed) {
      alert('This country has already been added.');
      return;
    }

    this.contestants.push({
      name:        this.newName,
      country:     this.newCountry,
      artist:      this.newArtist,
      song:        this.newSong,
      points:      0,
      scoreCounts: {}
    });

    // Clear form fields after adding.
    this.newCountry = '';
    this.newName    = '';
    this.newArtist  = '';
    this.newSong    = '';
  }

  // Returns true if a country value is already in the contestant list.
  // Used to grey out already-chosen countries in the dropdown.
  isCountryTaken(value: string): boolean {
    return this.contestants.some(c => c.country === value);
  }

  // Locks in the voter order alphabetically by contestant name.
  // Called once when "Start Contest" is clicked.
  // voterOrder never changes after this — scoreboard sorting
  // cannot influence who votes next.
  lockVoterOrder() {
    this.voterOrder = [...this.contestants]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => c.name);
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

  // How many point slots have been filled this round.
  // Drives the progress bar and Submit button state.
  get selectedVoteCount(): number {
    return Object.keys(this.currentRoundVotes).length;
  }

  // Advances to the next voter in the locked order.
  nextVoter() {
    this.usedPoints = [];
    if (this.currentVoterIndex < this.voterOrder.length - 1) {
      this.currentVoterIndex++;
    }
  }

  // Validates and submits the current round's votes.
  // Points are NOT added here — they are awarded one by
  // one during the reveal via nextReveal().
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

    // Save sorted lowest to highest for the reveal sequence.
    this.lastRoundVotes = Object.entries(this.currentRoundVotes)
      .map(([points, contestant]) => ({ contestant, points: Number(points) }))
      .sort((a, b) => a.points - b.points);

    // Reset round state and advance voter.
    this.currentRoundVotes  = {};
    this.usedPoints         = [];
    this.scoreSnapshot      = [];
    this.lastSubmittedVoter = this.currentVoter;
    this.nextVoter();
  }

  // =====================================================
  // SORTING
  // Primary: total points, highest first.
  // Tiebreaker: compare how many times each contestant
  // received each point value, from highest to lowest.
  // e.g. who received 12pts most often? Then 10pts? Etc.
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

  // =====================================================
  // ANIMATION
  // Uses the FLIP technique:
  // 1. Record Y positions of all rows before sorting.
  // 2. Sort (rows jump instantly in the DOM).
  // 3. Record new Y positions after Angular re-renders.
  // 4. Animate each row from its old position to its new one.
  // =====================================================

  animateSort() {
    const rows   = document.querySelectorAll('.score-row');
    const before = new Map<string, number>();

    // Record positions before sort.
    rows.forEach(row => {
      const name = (row as HTMLElement).dataset['name'];
      if (name) before.set(name, row.getBoundingClientRect().top);
    });

    // Sort instantly.
    this.sortContestants();

    // Animate from old to new positions after re-render.
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

  // Opens the reveal bar, starting from the first point.
  openReveal() {
    // Revert scoreboard to pre-reveal state if reveal has already started
    if (this.scoreSnapshot.length > 0) {
      this.contestants.forEach(c => {
        const snap = this.scoreSnapshot.find(s => s.name === c.name);
        if (snap) {
          c.points      = snap.points;
          c.scoreCounts = { ...snap.scoreCounts };
        }
      });
      this.sortContestants();
    }

    // Take a fresh snapshot of current scores
    this.scoreSnapshot = this.contestants.map(c => ({
      name:        c.name,
      points:      c.points,
      scoreCounts: { ...c.scoreCounts }
    }));

    this.revealIndex = 0;
    this.showReveal  = true;
  }

  // Awards the current point to the contestant,
  // animates the scoreboard, then advances the reveal.
  // After the last point, checks if the contest is over.
  nextReveal() {

    const now = Date.now();
    if (now - this.lastRevealClick < 700) return;
    this.lastRevealClick = now;

    const current    = this.lastRoundVotes[this.revealIndex];
    const contestant = this.contestants.find(c => c.name === current.contestant);

    if (contestant) {
      // Add to total points.
      contestant.points += current.points;

      // Increment frequency count for this point value (used in tiebreaker).
      contestant.scoreCounts[current.points] =
        (contestant.scoreCounts[current.points] ?? 0) + 1;

      this.votes.push({
        voter:      this.lastSubmittedVoter,
        contestant: contestant.name,
        points:     current.points
      });
    }

    // Animate the scoreboard re-sort.
    this.animateSort();

    // After animation completes, advance or close the reveal.
    setTimeout(() => {
      if (this.revealIndex < this.lastRoundVotes.length - 1) {
        this.revealIndex++;
      } else {
        this.showReveal  = false;
        this.revealIndex = 0;
        if (this.currentVoterIndex >= this.voterOrder.length) {
          this.contestOver = true;
        }
      }
    }, 700);
  }

  // =====================================================
  // UTILITY
  // =====================================================

  // Used by *ngFor trackBy on the scoreboard rows.
  // Prevents Angular from destroying/recreating DOM elements
  // when the array re-sorts, which is required for FLIP animation.
  trackByName(index: number, contestant: { name: string }): string {
    return contestant.name;
  }

  // Used by *ngFor trackBy on the custom points inputs.
  // Prevents input focus from being lost when the array updates.
  trackByIndex(index: number): number {
    return index;
  }

}