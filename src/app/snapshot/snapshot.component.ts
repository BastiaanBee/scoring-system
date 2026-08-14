// snapshot.component.ts — read-only reveal page for a specific voting round.
// Loaded from a shared link by viewers. Fetches snapshot data from Firestore
// and lets the viewer click through the reveal sequence independently.
import { Component, OnInit, OnDestroy, ViewEncapsulation, ChangeDetectorRef } from '@angular/core';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { doc, getDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../firebase.config';

interface ContestFact {
  type: string;
  icon: string;
  title: string;
  description: string;

  // Internal ranking value. This is never shown to viewers.
  specialtyScore: number;

  // Used only to prevent the final three cards from becoming
  // too repetitive when several facts concern the same people.
  contestants: string[];
}

@Component({
  selector: 'app-snapshot',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './snapshot.component.html',
  styleUrl: './snapshot.component.css',
  encapsulation: ViewEncapsulation.None,
})
export class SnapshotComponent implements OnInit, OnDestroy {
  constructor(
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
  ) {
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

  contestTitle = '';
  voter = '';
  maxPointValue = 0;
  voterOrder: string[] = [];
  currentVoterIndex = 0;

  // The scoreboard as it was BEFORE this round's points were awarded.
  preRoundSnapshot: {
    name: string;
    country: string;
    artist: string;
    song: string;
    points: number;
    scoreCounts: { [points: number]: number };
    maxPointVoters: string[];
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
    name: string;
    country: string;
    artist: string;
    song: string;
    points: number;
    scoreCounts: { [points: number]: number };
    maxPointVoters: string[];
  }[] = [];

  // Which entry in lastRoundVotes is currently being revealed.
  revealIndex = 0;

  // Whether all points have been revealed.
  revealComplete = false;

  // Names of contestants revealed so far — for row highlighting.
  revealedContestants: Set<string> = new Set();

  // Throttle clicks to prevent double-reveals.
  lastRevealClick = 0;

  // Whether the user has clicked anything to start the reveal yet.
  // Hides the banner content until first interaction.
  revealStarted = false;

  // Accumulated points received this round per contestant, for (+x) notifiers.
  roundPointsReceived: { [name: string]: number } = {};

  // Temporarily highlighted contestant (yellow) for the latest revealed points.
  lastAwardedContestant = '';

  // Delay before clearing the final reveal's yellow highlight.
  private readonly finalAwardHighlightMs = 1200;
  private clearAwardHighlightTimeout: ReturnType<typeof setTimeout> | null = null;

  // Whether autoplay is currently running.
  isAutoplaying = false;

  // Reference to the autoplay interval so it can be cleared on pause.
  autoplayInterval: any = null;

  // Whether this is a final results snapshot (no reveal sequence).
  isFinalSnapshot = false;

  // Final standings for a final results snapshot.
  finalContestants: any[] = [];

  // Complete voting history included with final snapshots.
  // This is used only to add a second worksheet to the Export button.
  voteMatrix: { [voter: string]: { [recipient: string]: number | null } } = {};

  // =====================================================
  // INITIALISATION
  // =====================================================

  async ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = 'Invalid snapshot link.';
      this.loading = false;
      this.cdr.detectChanges();
      return;
    }

    try {
      const docRef = doc(db, 'snapshots', id);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        this.error = 'This snapshot does not exist or has been deleted.';
        this.loading = false;
        return;
      }

      const data = docSnap.data();

      // Check if this is a final results snapshot.
      if (data['type'] === 'final') {
        this.isFinalSnapshot = true;
        this.finalContestants = data['contestants'] || [];
        this.contestTitle = data['contestTitle'] || '';
        this.voterOrder = data['voterOrder'] || [];
        this.voteMatrix = data['voteMatrix'] || {};
        this.loading = false;
        this.cdr.detectChanges();
        return;
      }

      this.contestTitle = data['contestTitle'] || '';
      this.voter = data['voter'] || '';
      this.maxPointValue = data['maxPointValue'] || 0;
      this.voterOrder = data['voterOrder'] || [];
      this.currentVoterIndex = data['currentVoterIndex'] || 0;
      this.preRoundSnapshot = data['preRoundSnapshot'] || [];
      this.lastRoundVotes = data['lastRoundVotes'] || [];

      // Initialise displayContestants from the pre-round snapshot, sorted.
      this.displayContestants = this.preRoundSnapshot.map((c) => ({
        ...c,
        scoreCounts: { ...c.scoreCounts },
        maxPointVoters: [...(c.maxPointVoters || [])],
      }));
      this.sortDisplayContestants();
    } catch (err) {
      console.error('Failed to load snapshot:', err);
      this.error = 'Failed to load snapshot. Please try again.';
    }

    this.loading = false;
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    this.clearAwardHighlightTimer();
    clearInterval(this.autoplayInterval);
  }

  // Returns true if this contestant is the voter for this snapshot round.
  isCurrentVoter(name: string): boolean {
    return name === this.voter;
  }

  // Returns true if this contestant has already voted in an earlier round.
  // Old snapshots may not have voterOrder/currentVoterIndex, so fail safely.
  hasAlreadyVoted(name: string): boolean {
    const voterIndex = this.voterOrder.indexOf(name);
    if (voterIndex < 0) return false;
    return voterIndex < this.currentVoterIndex;
  }

  // =====================================================
  // REVEAL METHODS
  // =====================================================

  // Reveals the next point in the sequence.
  nextReveal() {
    this.revealStarted = true;
    const now = Date.now();
    if (now - this.lastRevealClick < 700) return;
    this.lastRevealClick = now;

    const current = this.lastRoundVotes[this.revealIndex];
    if (!current) return;

    this.clearAwardHighlightTimer();
    this.lastAwardedContestant = current.contestant;

    const isFinalReveal = this.revealIndex >= this.lastRoundVotes.length - 1;
    const d = this.displayContestants.find((d) => d.name === current.contestant);

    if (d) {
      d.points += current.points;
      this.roundPointsReceived[current.contestant] =
        (this.roundPointsReceived[current.contestant] ?? 0) + current.points;
      d.scoreCounts[current.points] = (d.scoreCounts[current.points] ?? 0) + 1;
      if (current.points === this.maxPointValue) {
        d.maxPointVoters = [...d.maxPointVoters, this.voter];
      }
    }

    this.revealedContestants.add(current.contestant);
    this.animateSort();

    if (isFinalReveal) {
      this.clearAwardHighlightTimeout = setTimeout(() => {
        this.lastAwardedContestant = '';
        this.clearAwardHighlightTimeout = null;
        this.cdr.detectChanges();
      }, this.finalAwardHighlightMs);
    }

    setTimeout(() => {
      if (this.revealIndex < this.lastRoundVotes.length - 1) {
        this.revealIndex++;
      }
    }, 700);
  }

  // Toggles autoplay on and off.
  // When active, steps through the reveal every 3 seconds automatically.
  toggleAutoplay() {
    this.revealStarted = true;
    if (this.isAutoplaying) {
      // Pause — clear the interval and reset the flag.
      clearInterval(this.autoplayInterval);
      this.autoplayInterval = null;
      this.isAutoplaying = false;
    } else {
      // Play — start the interval.
      this.isAutoplaying = true;
      this.autoplayInterval = setInterval(() => {
        if (this.revealIndex < this.lastRoundVotes.length - 1) {
          this.nextReveal();
        } else {
          // Last point reached — reveal it first, then stop autoplay after animation completes.
          this.nextReveal();
          setTimeout(() => {
            clearInterval(this.autoplayInterval);
            this.autoplayInterval = null;
            this.isAutoplaying = false;
            this.cdr.detectChanges();
          }, 700);
        }
      }, 3000);
    }
  }

  private clearAwardHighlightTimer() {
    if (!this.clearAwardHighlightTimeout) return;
    clearTimeout(this.clearAwardHighlightTimeout);
    this.clearAwardHighlightTimeout = null;
  }

  animateSort() {
    const rows = document.querySelectorAll('.score-row');
    const before = new Map<string, number>();

    rows.forEach((row) => {
      const name = (row as HTMLElement).dataset['name'];
      if (name) before.set(name, row.getBoundingClientRect().top);
    });

    this.sortDisplayContestants();
    this.cdr.detectChanges();

    setTimeout(() => {
      const rowsAfter = document.querySelectorAll('.score-row');
      rowsAfter.forEach((row) => {
        const el = row as HTMLElement;
        const name = el.dataset['name'];
        if (!name) return;
        const oldTop = before.get(name);
        const newTop = el.getBoundingClientRect().top;
        if (oldTop === undefined) return;
        const delta = oldTop - newTop;
        if (delta === 0) return;

        el.style.transition = 'none';
        el.style.transform = `translateY(${delta}px)`;

        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
          el.style.transform = 'translateY(0)';
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

  // Determines the maximum point value that was actually used
  // in this finished contest.
  //
  // This works for Eurovision, Formula 1 and custom scoring
  // without needing to store another value in Firestore.

  private get finalMaxPointValue(): number {
    const awardedPoints = Object.values(this.voteMatrix)
      .flatMap((row) => Object.values(row))
      .filter((points): points is number => typeof points === 'number');

    if (awardedPoints.length === 0) {
      return 0;
    }

    return Math.max(...awardedPoints);
  }

  get finalContestFacts(): ContestFact[] {
    if (!this.isFinalSnapshot || this.finalContestants.length === 0) {
      return [];
    }

    const candidates: ContestFact[] = [];

    const maxPoints = this.finalMaxPointValue;
    const totalContestants = this.finalContestants.length;
    const possibleVoters = Math.max(1, this.voterOrder.length - 1);

    // Maps contestant names to their final finishing positions.
    const finishingPositions = new Map<string, number>();

    this.finalContestants.forEach((contestant, index) => {
      finishingPositions.set(contestant.name, index + 1);
    });

    // =====================================================
    // MAXIMUM IMPACT
    // Most maximum scores received.
    // =====================================================

    const mostMaxScores = Math.max(
      ...this.finalContestants.map((contestant) => contestant.maxPointVoters?.length ?? 0),
    );

    if (mostMaxScores > 0) {
      const leaders = this.finalContestants.filter(
        (contestant) => (contestant.maxPointVoters?.length ?? 0) === mostMaxScores,
      );

      // If several contestants share the record, use the
      // highest-finishing one for this particular fact.
      const contestant = leaders[0];

      const extremeness = this.clamp01(mostMaxScores / possibleVoters);

      candidates.push({
        type: 'maximum-impact',
        icon: '🌟',
        title: 'Maximum Impact',
        description:
          `${contestant.name} received the maximum score ` +
          `${mostMaxScores} ${mostMaxScores === 1 ? 'time' : 'times'}${
            leaders.length === 1
              ? ', more than anyone else.'
              : ', tying for the most in the contest.'
          }`,
        specialtyScore: this.calculateSpecialtyScore(
          35,
          extremeness,
          this.getUniquenessBonus(leaders.length),
        ),
        contestants: [contestant.name],
      });
    }

    // =====================================================
    // BROADEST SUPPORT
    // Points received from the most different voters.
    // =====================================================

    if (this.voterOrder.length > 0 && Object.keys(this.voteMatrix).length > 0) {
      const supportCounts = this.finalContestants.map((contestant) => ({
        contestant,
        count: this.voterOrder.filter((voter) => {
          const points = this.voteMatrix?.[voter]?.[contestant.name];

          return typeof points === 'number' && points > 0;
        }).length,
      }));

      const broadestSupport = Math.max(...supportCounts.map((entry) => entry.count));

      if (broadestSupport > 0) {
        const leaders = supportCounts.filter((entry) => entry.count === broadestSupport);

        // finalContestants is already in final ranking order,
        // so the first tied contestant is the highest finisher.
        const chosen = leaders[0];

        const extremeness = this.clamp01(broadestSupport / possibleVoters);

        candidates.push({
          type: 'broadest-support',
          icon: '🤝',
          title: 'Broadest Support',
          description:
            `${chosen.contestant.name} received points from ` +
            `${broadestSupport} of ${possibleVoters} possible voters` +
            `${
              leaders.length === 1
                ? ', more than anyone else.'
                : ', tying for the broadest support.'
            }`,
          specialtyScore: this.calculateSpecialtyScore(
            30,
            extremeness,
            this.getUniquenessBonus(leaders.length),
          ),
          contestants: [chosen.contestant.name],
        });
      }
    }

    // =====================================================
    // BFF
    // Two contestants gave each other maximum points.
    // At most ONE BFF candidate is produced.
    // =====================================================

    if (maxPoints > 0) {
      const bffPairs: {
        first: string;
        second: string;
        rankSum: number;
      }[] = [];

      for (let i = 0; i < this.voterOrder.length; i++) {
        for (let j = i + 1; j < this.voterOrder.length; j++) {
          const first = this.voterOrder[i];
          const second = this.voterOrder[j];

          const firstToSecond = this.voteMatrix?.[first]?.[second];

          const secondToFirst = this.voteMatrix?.[second]?.[first];

          if (firstToSecond === maxPoints && secondToFirst === maxPoints) {
            bffPairs.push({
              first,
              second,
              rankSum:
                (finishingPositions.get(first) ?? totalContestants) +
                (finishingPositions.get(second) ?? totalContestants),
            });
          }
        }
      }

      if (bffPairs.length > 0) {
        // Prefer the pair with the strongest combined final result.
        // Alphabetical ordering resolves an exact tie deterministically.
        bffPairs.sort((a, b) => {
          if (a.rankSum !== b.rankSum) {
            return a.rankSum - b.rankSum;
          }

          return `${a.first}|${a.second}`.localeCompare(`${b.first}|${b.second}`);
        });

        const pair = bffPairs[0];

        // A mutual maximum vote is inherently unusual, so BFF
        // receives a constant moderate extremeness value.
        const extremeness = 0.5;

        candidates.push({
          type: 'bff',
          icon: '💞',
          title: 'BFF',
          description:
            `${pair.first} and ${pair.second} were clearly on ` +
            `the same wavelength: they gave each other the ` +
            `maximum score.`,
          specialtyScore: this.calculateSpecialtyScore(
            60,
            extremeness,
            this.getUniquenessBonus(bffPairs.length),
          ),
          contestants: [pair.first, pair.second],
        });
      }
    }

    // =====================================================
    // COLD HEART
    // One contestant gives another maximum points but
    // receives nothing from that contestant in return.
    // At most ONE candidate is produced.
    // =====================================================

    if (maxPoints > 0) {
      const coldHeartPairs: {
        giver: string;
        recipient: string;
        extremeness: number;
      }[] = [];

      for (const giver of this.voterOrder) {
        for (const recipient of this.voterOrder) {
          if (giver === recipient) continue;

          const given = this.voteMatrix?.[giver]?.[recipient];

          const returned = this.voteMatrix?.[recipient]?.[giver];

          if (
            given === maxPoints &&
            (returned === null || returned === undefined || returned === 0)
          ) {
            const giverPosition = finishingPositions.get(giver) ?? totalContestants;

            const recipientPosition = finishingPositions.get(recipient) ?? totalContestants;

            const positionGap =
              totalContestants > 1
                ? Math.abs(giverPosition - recipientPosition) / (totalContestants - 1)
                : 0;

            // Even a normal Cold Heart is interesting.
            // A large difference in final placement makes
            // the mismatch slightly more dramatic.
            const extremeness = 0.4 + 0.6 * this.clamp01(positionGap);

            coldHeartPairs.push({
              giver,
              recipient,
              extremeness,
            });
          }
        }
      }

      if (coldHeartPairs.length > 0) {
        coldHeartPairs.sort((a, b) => {
          if (b.extremeness !== a.extremeness) {
            return b.extremeness - a.extremeness;
          }

          return `${a.giver}|${a.recipient}`.localeCompare(`${b.giver}|${b.recipient}`);
        });

        const pair = coldHeartPairs[0];

        candidates.push({
          type: 'cold-heart',
          icon: '💔',
          title: 'Cold Heart',
          description:
            `${pair.giver} gave ${pair.recipient} the maximum ` +
            `score, but ${pair.recipient} gave ${pair.giver} ` +
            `nothing in return.`,
          specialtyScore: this.calculateSpecialtyScore(
            55,
            pair.extremeness,
            this.getUniquenessBonus(coldHeartPairs.length),
          ),
          contestants: [pair.giver, pair.recipient],
        });
      }
    }

    // =====================================================
    // HARSH LOSER
    // Someone received the joint-most or outright-most
    // maximum scores but did not win.
    // =====================================================

    if (mostMaxScores > 0 && totalContestants > 1) {
      const maxScoreLeaders = this.finalContestants
        .map((contestant, index) => ({
          contestant,
          position: index + 1,
        }))
        .filter(({ contestant }) => (contestant.maxPointVoters?.length ?? 0) === mostMaxScores);

      const nonWinningLeaders = maxScoreLeaders.filter(({ position }) => position > 1);

      if (nonWinningLeaders.length > 0) {
        // The lower someone finished despite holding the record,
        // the harsher this statistic becomes.
        nonWinningLeaders.sort((a, b) => b.position - a.position);

        const harshest = nonWinningLeaders[0];

        const extremeness =
          totalContestants <= 2
            ? 0
            : this.clamp01((harshest.position - 2) / (totalContestants - 2));

        const sharedRecord = maxScoreLeaders.length > 1;

        candidates.push({
          type: 'harsh-loser',
          icon: '😬',
          title: 'Harsh Loser',
          description:
            `${harshest.contestant.name} received the ` +
            `${sharedRecord ? 'joint-most' : 'most'} maximum ` +
            `${mostMaxScores === 1 ? 'score' : 'scores'} ` +
            `(${mostMaxScores}), but still finished ` +
            `${this.ordinal(harshest.position)}.`,
          specialtyScore: this.calculateSpecialtyScore(
            50,
            extremeness,
            this.getUniquenessBonus(nonWinningLeaders.length),
          ),
          contestants: [harshest.contestant.name],
        });
      }
    }

    // =====================================================
    // WINNING MARGIN
    // Small margins are more special than dominant victories.
    // =====================================================

    if (totalContestants >= 2) {
      const winner = this.finalContestants[0];
      const runnerUp = this.finalContestants[1];

      const margin = winner.points - runnerUp.points;

      let extremeness = 0;

      if (margin === 0) {
        extremeness = 1;
      } else {
        // Compare the margin against the contest's maximum
        // individual score. A one-point win therefore scores
        // highly, while a margin equal to or larger than one
        // maximum award has little specialty.
        extremeness = this.clamp01(1 - margin / Math.max(1, maxPoints));
      }

      candidates.push({
        type: 'winning-margin',
        icon: '🏁',
        title: margin === 0 ? 'Down to the Tiebreak' : 'Winning Margin',
        description:
          margin === 0
            ? `${winner.name} and ${runnerUp.name} both ` +
              `finished on ${winner.points} points, so the ` +
              `winner was decided by the contest's tiebreak rules.`
            : `${winner.name} won the contest by ${margin} ${
                margin === 1 ? 'point' : 'points'
              } over ${runnerUp.name}.`,
        specialtyScore: this.calculateSpecialtyScore(25, extremeness, 0),
        contestants: [winner.name, runnerUp.name],
      });
    }

    return this.selectTopContestFacts(candidates, 3);
  }

  // Specialty formula:
  //
  // base specialty
  // + up to 30 points for how extreme this occurrence is
  // + up to 10 points for how unique it is within the contest
  //
  // Final value is always capped between 0 and 100.
  private calculateSpecialtyScore(
    base: number,
    extremeness: number,
    uniquenessBonus: number,
  ): number {
    const score = base + 30 * this.clamp01(extremeness) + uniquenessBonus;

    return Math.min(100, Math.max(0, score));
  }

  // A phenomenon is more notable when it occurs only once.
  private getUniquenessBonus(occurrenceCount: number): number {
    if (occurrenceCount <= 1) return 10;
    if (occurrenceCount === 2) return 6;
    if (occurrenceCount === 3) return 3;

    return 0;
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  // Selects the most special facts without randomness.
  //
  // A fact loses 10 effective points if it concerns a contestant
  // who already appears in one of the selected facts. This does
  // not ban repeated contestants; it merely gives similarly-scored
  // facts about different people a slight advantage.
  private selectTopContestFacts(candidates: ContestFact[], limit: number): ContestFact[] {
    const remaining = [...candidates];
    const selected: ContestFact[] = [];
    const usedContestants = new Set<string>();

    // Fixed order used only when two calculated scores are
    // otherwise exactly equal.
    const typePriority: Record<string, number> = {
      bff: 1,
      'cold-heart': 2,
      'harsh-loser': 3,
      'maximum-impact': 4,
      'broadest-support': 5,
      'winning-margin': 6,
    };

    while (remaining.length > 0 && selected.length < limit) {
      remaining.sort((a, b) => {
        const aOverlap = a.contestants.some((name) => usedContestants.has(name));

        const bOverlap = b.contestants.some((name) => usedContestants.has(name));

        const aAdjusted = a.specialtyScore - (aOverlap ? 10 : 0);

        const bAdjusted = b.specialtyScore - (bOverlap ? 10 : 0);

        if (bAdjusted !== aAdjusted) {
          return bAdjusted - aAdjusted;
        }

        if (b.specialtyScore !== a.specialtyScore) {
          return b.specialtyScore - a.specialtyScore;
        }

        return (typePriority[a.type] ?? 999) - (typePriority[b.type] ?? 999);
      });

      const winner = remaining.shift();

      if (!winner) break;

      selected.push(winner);

      for (const contestant of winner.contestants) {
        usedContestants.add(contestant);
      }
    }

    return selected;
  }

  private ordinal(position: number): string {
    const mod100 = position % 100;

    if (mod100 >= 11 && mod100 <= 13) {
      return `${position}th`;
    }

    switch (position % 10) {
      case 1:
        return `${position}st`;
      case 2:
        return `${position}nd`;
      case 3:
        return `${position}rd`;
      default:
        return `${position}th`;
    }
  }

  // Formats a list of contestant names naturally for fact descriptions.
  // Examples:
  // ["A"]             → "A"
  // ["A", "B"]        → "A and B"
  // ["A", "B", "C"]   → "A, B and C"
  private formatFactNames(names: string[]): string {
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];

    if (names.length === 2) {
      return `${names[0]} and ${names[1]}`;
    }

    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  // Returns tooltip string for the max point voters dot column.
  getMaxPointVotersTooltip(voters: string[]): string {
    if (!voters || voters.length === 0) return '';
    return voters.join(', ');
  }

  // Adds the complete voter-by-recipient matrix as a second worksheet.
  // Older final snapshots without voting history still export normally.
  private appendVotingHistorySheet(workbook: XLSX.WorkBook) {
    if (!this.voterOrder.length || Object.keys(this.voteMatrix).length === 0) return;

    // Keep the exact requested column order. Object-based worksheet creation
    // reorders integer-like contestant names such as "655" before "Voter".
    const historyRows: (string | number)[][] = [['Voter', ...this.voterOrder, 'Total Awarded']];

    for (const voter of this.voterOrder) {
      const recipientCells = this.voterOrder.map((recipient) =>
        voter === recipient ? '—' : (this.voteMatrix?.[voter]?.[recipient] ?? ''),
      );

      const totalAwarded = Object.values(this.voteMatrix?.[voter] ?? {}).reduce<number>(
        (total, points) => total + (points ?? 0),
        0,
      );

      historyRows.push([voter, ...recipientCells, totalAwarded]);
    }

    const receivedCells = this.voterOrder.map((recipient) =>
      this.voterOrder.reduce(
        (total, voter) => total + (this.voteMatrix?.[voter]?.[recipient] ?? 0),
        0,
      ),
    );

    historyRows.push(['Received', ...receivedCells, '']);

    const historySheet = XLSX.utils.aoa_to_sheet(historyRows);
    historySheet['!cols'] = [
      { wch: Math.max(12, ...this.voterOrder.map((name) => name.length + 2)) },
      ...this.voterOrder.map((name) => ({ wch: Math.max(8, Math.min(name.length + 2, 22)) })),
      { wch: 15 },
    ];

    XLSX.utils.book_append_sheet(workbook, historySheet, 'Voting History');
  }

  // Exports the current scoreboard state to an Excel (.xlsx) file.
  exportToExcel() {
    const contestants = this.isFinalSnapshot ? this.finalContestants : this.displayContestants;
    const rows = contestants.map((c: any, i: number) => ({
      Rank: i + 1,
      Country: c.country.replace(/[^\p{L}\p{N} ]/gu, '').trim(),
      Participant: c.name,
      Artist: c.artist,
      Song: c.song,
      'Max Points Received': c.maxPointVoters?.length ?? 0,
      'Total Points': c.points,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Standings');

    if (this.isFinalSnapshot) {
      this.appendVotingHistorySheet(workbook);
    }

    const filename = this.isFinalSnapshot
      ? `${this.contestTitle || 'Contest'} Final Results.xlsx`
      : `${this.contestTitle || 'Contest'} Scoreboard ${this.voter}'s Votes.xlsx`;
    XLSX.writeFile(workbook, filename);
  }

  // trackBy for the scoreboard *ngFor.
  trackByName(index: number, contestant: { name: string }): string {
    return contestant.name;
  }

  // Returns the flagcdn.com image URL for a country string like '🇳🇱 Netherlands'.
  // Returns empty string if the country string doesn't start with a regional indicator pair.
  getFlagUrl(country: string): string {
    if (!country) return '';

    // Name-based lookup for subdivision flags (tag sequences) that cannot be
    // derived from regional indicator characters — e.g. 🏴󠁧󠁢󠁥󠁮󠁧󠁿 England.
    const subdivisionMap: { [key: string]: string } = {
      England: 'gb-eng',
      Scotland: 'gb-sct',
      Wales: 'gb-wls',
    };
    const stripped = country.replace(/[^\p{L}\p{N} ]/gu, '').trim();
    if (subdivisionMap[stripped]) {
      return `https://flagcdn.com/w20/${subdivisionMap[stripped]}.png`;
    }

    const cp1 = country.codePointAt(0);
    const cp2 = country.codePointAt(2);
    if (!cp1 || !cp2 || cp1 < 0x1f1e6 || cp1 > 0x1f1ff || cp2 < 0x1f1e6 || cp2 > 0x1f1ff) return '';
    const code = String.fromCharCode(cp1 - 0x1f1e6 + 65) + String.fromCharCode(cp2 - 0x1f1e6 + 65);
    return `https://flagcdn.com/w20/${code.toLowerCase()}.png`;
  }

  // Returns the country name with the flag emoji stripped.
  getCountryName(country: string): string {
    return country ? country.replace(/[^\p{L}\p{N} ]/gu, '').trim() : '';
  }
}
