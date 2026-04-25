import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface Enemy {
  x: number;
  y: number;
  vy: number;
  hp: number;
}

interface SpawnStep {
  timeFromStartSeconds: number;
  xRatio: number;
}

type PlayerSpriteDirection = 'center' | 'left' | 'right';
type GameState = 'menu' | 'briefing' | 'playing' | 'paused' | 'levelEnding' | 'levelComplete';

@Component({
  selector: 'app-shooter',
  templateUrl: './shooter.component.html',
  styleUrl: './shooter.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShooterComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true })
  private readonly gameCanvasRef!: ElementRef<HTMLCanvasElement>;

  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  private context: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly keysPressed = new Set<string>();

  protected gameState: GameState = 'menu';
  protected helpOpen = false;
  protected menuFocusIndex = 0;

  private readonly player = {
    x: 0,
    y: 0,
    radius: 16,
    speed: 260,
  };

  private readonly playerSprites: Record<PlayerSpriteDirection, HTMLImageElement> = {
    center: new Image(),
    left: new Image(),
    right: new Image(),
  };
  private readonly playerSpriteLoaded: Record<PlayerSpriteDirection, boolean> = {
    center: false,
    left: false,
    right: false,
  };
  private playerSpriteDirection: PlayerSpriteDirection = 'center';
  private readonly playerSpriteWidth = 72;
  private readonly playerSpriteHeight = 72;

  private readonly boostSprite = new Image();
  private boostSpriteLoaded = false;
  private readonly boostSpriteWidth = 34;
  private readonly boostSpriteHeight = 46;
  private readonly boostSideOffset = 17;
  private isBoostingForward = false;

  private readonly fireSprite = new Image();
  private fireSpriteLoaded = false;
  private readonly fireSpriteHeight = 24;
  private readonly fireSpriteFallbackWidth = 12;

  private readonly levelMusic = new Audio('/assets/shooter/Sector%20Patrol.mp3');
  private readonly victoryMusic = new Audio('/assets/shooter/Victory.mp3');
  private retryVictoryOnNextGesture = false;

  private enemyGifLoaded = false;
  private enemyAnimationFrames: ImageBitmap[] = [];
  private enemyAnimationFrameDurationMs = 80;
  private enemyAnimationClockMs = 0;
  private readonly enemySpriteHeight = 62;
  private readonly enemySpriteFallbackWidth = 62;

  private readonly backgroundSprite = new Image();
  private backgroundSpriteLoaded = false;
  private backgroundScrollOffset = 0;
  private readonly backgroundScrollSpeed = 28;
  private readonly backgroundWidthScale = 1.16;
  private readonly backgroundParallaxStrength = 0.45;

  private bullets: Bullet[] = [];
  private enemies: Enemy[] = [];

  private width = 0;
  private height = 0;
  private lastTimestamp = 0;
  private fireCooldown = 0;
  private score = 0;
  private shields = 3;
  private integrity = 100;
  private levelNumber = 1;
  private levelElapsedSeconds = 0;
  private nextSpawnIndex = 0;
  private level1SpawnedCount = 0;
  private level1DestroyedCount = 0;
  private level1EscapedCount = 0;
  private isPlayerInputLocked = false;
  private levelEndingVelocityY = 0;
  protected musicEnabled = true;

  private readonly bulletSpeed = 500;
  private readonly fireIntervalSeconds = 0.12;
  private readonly enemySpeed = 88;
  private readonly enemyHitPoints = 5;
  private readonly enemyKillScore = 1000;
  private readonly enemyEscapeScorePenalty = this.enemyKillScore / 2;
  private readonly enemyCollisionScorePenalty = 500;
  private readonly maxShields = 3;
  private readonly integrityDamagePerHit = 20;
  private readonly shieldRechargeIntervalSeconds = 15;
  private readonly playerBottomOffset = 28;
  private shieldRechargeTimer = this.shieldRechargeIntervalSeconds;
  private readonly levelEndingInitialSpeed = 300;
  private readonly levelEndingAcceleration = 620;
  private readonly levelEndingScrollMultiplier = 1.55;
  private readonly level1MaxSpawns = 50;
  private level1SpawnSchedule: SpawnStep[] = [];

  private readonly onWindowResize = () => {
    this.resizeCanvas();
  };

  private readonly onWindowKeyDown = (event: KeyboardEvent) => {
    if (this.retryVictoryOnNextGesture && (event.code === 'Enter' || event.code === 'Space')) {
      this.retryVictoryOnNextGesture = false;
      this.playVictoryMusic(false);
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      if (this.gameState === 'playing') {
        this.keysPressed.clear();
        this.gameState = 'paused';
        this.menuFocusIndex = 0;
        this.pauseLevelMusic();
        this.cdr.markForCheck();
      } else if (this.gameState === 'paused') {
        this.resumeGame();
      } else if (this.gameState === 'briefing') {
        this.returnToMainMenu();
      } else if (this.gameState === 'levelComplete') {
        this.returnToMainMenu();
      }
      return;
    }

    const canNavigateMenu =
      this.gameState === 'menu' ||
      this.gameState === 'paused' ||
      this.gameState === 'briefing' ||
      this.gameState === 'levelComplete';

    if (canNavigateMenu) {
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown' || event.code === 'Enter') {
        event.preventDefault();
        const items = this.activeMenuItems;
        if (event.code === 'ArrowUp') {
          this.menuFocusIndex = (this.menuFocusIndex - 1 + items.length) % items.length;
        } else if (event.code === 'ArrowDown') {
          this.menuFocusIndex = (this.menuFocusIndex + 1) % items.length;
        } else {
          items[this.menuFocusIndex]?.action();
        }
        this.cdr.markForCheck();
        return;
      }
    }

    if (this.gameState !== 'playing') {
      return;
    }

    this.keysPressed.add(event.code);

    if (event.code === 'Space') {
      event.preventDefault();
    }
  };

  private readonly onWindowKeyUp = (event: KeyboardEvent) => {
    this.keysPressed.delete(event.code);
  };

  private readonly onWindowPointerDown = () => {
    if (!this.retryVictoryOnNextGesture) {
      return;
    }

    this.retryVictoryOnNextGesture = false;
    this.playVictoryMusic(false);
  };

  goHome(): void {
    this.stopLevelMusic();
    this.stopVictoryMusic();
    this.router.navigate(['/']);
  }

  openMissionBriefing(): void {
    this.stopVictoryMusic();
    this.playLevelMusic(true);
    this.helpOpen = false;
    this.menuFocusIndex = 0;
    this.gameState = 'briefing';
  }

  startNewGame(): void {
    const cameFromBriefing = this.gameState === 'briefing';

    this.bullets = [];
    this.enemies = [];
    this.score = 0;
    this.levelNumber = 1;
    this.levelElapsedSeconds = 0;
    this.nextSpawnIndex = 0;
    this.level1SpawnedCount = 0;
    this.level1DestroyedCount = 0;
    this.level1EscapedCount = 0;
    this.level1SpawnSchedule = this.buildLevel1SpawnSchedule();
    this.isPlayerInputLocked = false;
    this.levelEndingVelocityY = 0;
    this.shields = this.maxShields;
    this.integrity = 100;
    this.shieldRechargeTimer = this.shieldRechargeIntervalSeconds;
    this.fireCooldown = 0;
    this.lastTimestamp = 0;
    this.player.x = this.width / 2;
    this.player.y = this.height - this.playerBottomOffset - this.player.radius;
    this.keysPressed.clear();
    this.helpOpen = false;
    this.gameState = 'playing';
    this.stopVictoryMusic();
    this.playLevelMusic(!cameFromBriefing);
  }

  loadGame(): void {
    // Not yet implemented.
  }

  resumeGame(): void {
    this.gameState = 'playing';
    this.lastTimestamp = 0;
    this.playLevelMusic(false);
    this.cdr.markForCheck();
  }

  returnToMainMenu(): void {
    this.bullets = [];
    this.enemies = [];
    this.score = 0;
    this.levelNumber = 1;
    this.levelElapsedSeconds = 0;
    this.nextSpawnIndex = 0;
    this.level1SpawnedCount = 0;
    this.level1DestroyedCount = 0;
    this.level1EscapedCount = 0;
    this.isPlayerInputLocked = false;
    this.levelEndingVelocityY = 0;
    this.shields = this.maxShields;
    this.integrity = 100;
    this.shieldRechargeTimer = this.shieldRechargeIntervalSeconds;
    this.keysPressed.clear();
    this.helpOpen = false;
    this.menuFocusIndex = 0;
    this.gameState = 'menu';
    this.stopLevelMusic();
    this.stopVictoryMusic();
    this.cdr.markForCheck();
  }

  toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    this.menuFocusIndex = 0;
  }

  toggleMusic(): void {
    this.musicEnabled = !this.musicEnabled;

    if (!this.musicEnabled) {
      this.stopLevelMusic();
      this.stopVictoryMusic();
      return;
    }

    if (this.gameState === 'levelEnding' || this.gameState === 'levelComplete') {
      this.playVictoryMusic(false);
      return;
    }

    if (this.gameState === 'briefing' || this.gameState === 'playing' || this.gameState === 'paused') {
      this.playLevelMusic(false);
    }
  }

  private get activeMenuItems(): Array<{ action: () => void }> {
    if (this.gameState === 'paused') {
      return [
        { action: () => this.resumeGame() },
        { action: () => this.startNewGame() },
        { action: () => this.returnToMainMenu() },
      ];
    }
    if (this.gameState === 'menu' && this.helpOpen) {
      return [{ action: () => this.toggleHelp() }];
    }
    if (this.gameState === 'menu') {
      return [
        { action: () => this.openMissionBriefing() },
        { action: () => this.toggleHelp() },
      ];
    }
    if (this.gameState === 'briefing') {
      return [{ action: () => this.startNewGame() }];
    }
    if (this.gameState === 'levelComplete') {
      return [
        { action: () => this.startNewGame() },
        { action: () => this.returnToMainMenu() },
      ];
    }
    return [];
  }

  ngAfterViewInit(): void {
    const canvas = this.gameCanvasRef.nativeElement;
    this.context = canvas.getContext('2d');

    if (!this.context) {
      return;
    }

    this.levelMusic.loop = true;
    this.levelMusic.volume = 0.45;
    this.levelMusic.preload = 'auto';
    this.victoryMusic.loop = false;
    this.victoryMusic.volume = 0.52;
    this.victoryMusic.preload = 'auto';

    void this.loadEnemyAnimationFrames();
    this.loadPlayerSprite();

    this.attachInputListeners();
    this.attachResizeObserver();
    window.requestAnimationFrame(() => this.resizeCanvas(true));
    this.animationFrameId = window.requestAnimationFrame(this.gameLoop);
  }

  ngOnDestroy(): void {
    this.detachInputListeners();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopLevelMusic();
    this.stopVictoryMusic();
    for (const frame of this.enemyAnimationFrames) {
      frame.close();
    }
    this.enemyAnimationFrames = [];

    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
    }
  }

  private readonly gameLoop = (timestamp: number) => {
    if (!this.context) {
      return;
    }

    if (this.lastTimestamp === 0) {
      this.lastTimestamp = timestamp;
    }

    const deltaSeconds = Math.min((timestamp - this.lastTimestamp) / 1000, 1 / 30);
    this.lastTimestamp = timestamp;

    this.update(deltaSeconds);
    this.render();

    this.animationFrameId = window.requestAnimationFrame(this.gameLoop);
  };

  private attachInputListeners(): void {
    window.addEventListener('resize', this.onWindowResize);
    window.addEventListener('keydown', this.onWindowKeyDown);
    window.addEventListener('keyup', this.onWindowKeyUp);
    window.addEventListener('pointerdown', this.onWindowPointerDown);
  }

  private detachInputListeners(): void {
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    window.removeEventListener('keyup', this.onWindowKeyUp);
    window.removeEventListener('pointerdown', this.onWindowPointerDown);
  }

  private attachResizeObserver(): void {
    const canvas = this.gameCanvasRef.nativeElement;
    const resizeTarget = canvas.parentElement ?? canvas;

    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
    });
    this.resizeObserver.observe(resizeTarget);
  }

  private update(deltaSeconds: number): void {
    if (this.gameState !== 'playing' && this.gameState !== 'levelEnding') {
      return;
    }

    const scrollMultiplier = this.gameState === 'levelEnding' ? this.levelEndingScrollMultiplier : 1;
    this.backgroundScrollOffset =
      (this.backgroundScrollOffset + this.backgroundScrollSpeed * scrollMultiplier * deltaSeconds) % this.height;

    this.enemyAnimationClockMs += deltaSeconds * 1000;

    if (this.gameState === 'levelEnding') {
      this.updateLevelEnding(deltaSeconds);
      return;
    }

    this.levelElapsedSeconds += deltaSeconds;

    this.updatePlayer(deltaSeconds);

    this.fireCooldown = Math.max(0, this.fireCooldown - deltaSeconds);
    if (this.keysPressed.has('Space')) {
      this.tryFire();
    }

    this.updateShieldRecharge(deltaSeconds);

    this.updateBullets(deltaSeconds);
    this.updateEnemies(deltaSeconds);
    this.handleProjectileEnemyCollisions();
    this.handleEnemyPlayerCollisions();
    this.tryStartLevelEnding();
  }

  private updatePlayer(deltaSeconds: number): void {
    if (this.isPlayerInputLocked) {
      return;
    }

    let dx = 0;
    let dy = 0;

    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) {
      dx -= 1;
    }

    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) {
      dx += 1;
    }

    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) {
      dy -= 1;
    }

    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) {
      dy += 1;
    }

    if (dx !== 0) {
      this.player.x += dx * this.player.speed * deltaSeconds;
    }

    if (dy !== 0) {
      this.player.y += dy * this.player.speed * deltaSeconds;
    }

    this.isBoostingForward = dy < 0;

    if (dx < 0) {
      this.playerSpriteDirection = 'left';
    } else if (dx > 0) {
      this.playerSpriteDirection = 'right';
    } else {
      this.playerSpriteDirection = 'center';
    }

    this.player.x = Math.max(this.player.radius, Math.min(this.width - this.player.radius, this.player.x));
    this.player.y = Math.max(this.player.radius, Math.min(this.height - this.player.radius, this.player.y));
  }

  private tryFire(): void {
    if (this.isPlayerInputLocked) {
      return;
    }

    if (this.fireCooldown > 0) {
      return;
    }

    this.fireCooldown = this.fireIntervalSeconds;

    const muzzleOffset = this.player.radius + 10;
    const bulletRadius = 3;

    this.bullets.push({
      x: this.player.x,
      y: this.player.y - muzzleOffset,
      vx: 0,
      vy: -this.bulletSpeed,
      radius: bulletRadius,
    });
  }

  private updateBullets(deltaSeconds: number): void {
    this.bullets = this.bullets
      .map((bullet) => ({
        ...bullet,
        x: bullet.x + bullet.vx * deltaSeconds,
        y: bullet.y + bullet.vy * deltaSeconds,
      }))
      .filter(
        (bullet) =>
          bullet.x >= -bullet.radius &&
          bullet.x <= this.width + bullet.radius &&
          bullet.y >= -bullet.radius &&
          bullet.y <= this.height + bullet.radius,
      );
  }

  private updateEnemies(deltaSeconds: number): void {
    while (this.nextSpawnIndex < this.level1SpawnSchedule.length) {
      const step = this.level1SpawnSchedule[this.nextSpawnIndex];
      if (step.timeFromStartSeconds > this.levelElapsedSeconds) {
        break;
      }

      this.spawnEnemyAtRatio(step.xRatio);
      this.nextSpawnIndex += 1;
      this.level1SpawnedCount += 1;
    }

    const remainingEnemies: Enemy[] = [];
    for (const enemy of this.enemies) {
      const updatedEnemy = {
        ...enemy,
        y: enemy.y + enemy.vy * deltaSeconds,
      };

      const escapedBottom = updatedEnemy.y - this.enemySpriteHeight / 2 > this.height + 20;
      if (escapedBottom) {
        this.level1EscapedCount += 1;
        this.score = Math.max(0, this.score - this.enemyEscapeScorePenalty);
        continue;
      }

      remainingEnemies.push(updatedEnemy);
    }

    this.enemies = remainingEnemies;
  }

  private spawnEnemyAtRatio(xRatio: number): void {
    const enemySource = this.getEnemyFrameSource();
    const enemyWidth = enemySource
      ? this.getScaledWidthFromHeight(
          enemySource,
          this.enemySpriteHeight,
          this.enemySpriteFallbackWidth,
        )
      : this.enemySpriteFallbackWidth;
    const halfWidth = enemyWidth / 2;
    const minX = halfWidth;
    const maxX = Math.max(halfWidth, this.width - halfWidth);
    const ratioX = this.width * xRatio;
    const spawnX = Math.max(minX, Math.min(maxX, ratioX));

    this.enemies.push({
      x: spawnX,
      y: -this.enemySpriteHeight / 2,
      vy: this.enemySpeed,
      hp: this.enemyHitPoints,
    });
  }

  private handleProjectileEnemyCollisions(): void {
    if (this.bullets.length === 0 || this.enemies.length === 0) {
      return;
    }

    const enemySource = this.getEnemyFrameSource();
    const enemyWidth = enemySource
      ? this.getScaledWidthFromHeight(
          enemySource,
          this.enemySpriteHeight,
          this.enemySpriteFallbackWidth,
        )
      : this.enemySpriteFallbackWidth;
    const halfEnemyWidth = enemyWidth / 2;
    const halfEnemyHeight = this.enemySpriteHeight / 2;

    const remainingBullets: Bullet[] = [];

    for (const bullet of this.bullets) {
      let bulletConsumed = false;

      for (let enemyIndex = 0; enemyIndex < this.enemies.length; enemyIndex += 1) {
        const enemy = this.enemies[enemyIndex];
        const overlapsEnemy =
          bullet.x + bullet.radius >= enemy.x - halfEnemyWidth &&
          bullet.x - bullet.radius <= enemy.x + halfEnemyWidth &&
          bullet.y + bullet.radius >= enemy.y - halfEnemyHeight &&
          bullet.y - bullet.radius <= enemy.y + halfEnemyHeight;

        if (!overlapsEnemy) {
          continue;
        }

        bulletConsumed = true;
        enemy.hp -= 1;

        if (enemy.hp <= 0) {
          this.enemies.splice(enemyIndex, 1);
          this.level1DestroyedCount += 1;
          this.score += this.enemyKillScore;
        }

        break;
      }

      if (!bulletConsumed) {
        remainingBullets.push(bullet);
      }
    }

    this.bullets = remainingBullets;
  }

  private handleEnemyPlayerCollisions(): void {
    if (this.enemies.length === 0) {
      return;
    }

    const enemySource = this.getEnemyFrameSource();
    const enemyWidth = enemySource
      ? this.getScaledWidthFromHeight(
          enemySource,
          this.enemySpriteHeight,
          this.enemySpriteFallbackWidth,
        )
      : this.enemySpriteFallbackWidth;
    const halfEnemyWidth = enemyWidth / 2;
    const halfEnemyHeight = this.enemySpriteHeight / 2;

    const remainingEnemies: Enemy[] = [];

    for (const enemy of this.enemies) {
      const overlapsPlayer =
        this.player.x + this.player.radius >= enemy.x - halfEnemyWidth &&
        this.player.x - this.player.radius <= enemy.x + halfEnemyWidth &&
        this.player.y + this.player.radius >= enemy.y - halfEnemyHeight &&
        this.player.y - this.player.radius <= enemy.y + halfEnemyHeight;

      if (overlapsPlayer) {
        this.applyPlayerHit();
      } else {
        remainingEnemies.push(enemy);
      }
    }

    this.enemies = remainingEnemies;
  }

  private updateShieldRecharge(deltaSeconds: number): void {
    if (this.shields >= this.maxShields) {
      this.shieldRechargeTimer = this.shieldRechargeIntervalSeconds;
      return;
    }

    this.shieldRechargeTimer -= deltaSeconds;
    while (this.shieldRechargeTimer <= 0 && this.shields < this.maxShields) {
      this.shields += 1;
      this.shieldRechargeTimer += this.shieldRechargeIntervalSeconds;
    }
  }

  private applyPlayerHit(): void {
    this.score = Math.max(0, this.score - this.enemyCollisionScorePenalty);

    if (this.shields > 0) {
      this.shields -= 1;
      this.shieldRechargeTimer = this.shieldRechargeIntervalSeconds;
      return;
    }

    this.integrity = Math.max(0, this.integrity - this.integrityDamagePerHit);
  }

  private tryStartLevelEnding(): void {
    const allScheduledEnemiesSpawned = this.nextSpawnIndex >= this.level1SpawnSchedule.length;
    if (!allScheduledEnemiesSpawned) {
      return;
    }

    if (this.enemies.length > 0) {
      return;
    }

    this.startLevelEnding();
  }

  private buildLevel1SpawnSchedule(): SpawnStep[] {
    const schedule: SpawnStep[] = [];
    const minEdgeRatio = 0.1;
    const maxEdgeRatio = 0.9;
    let elapsed = 1.0;
    let lastSingleRatio = 0.5;

    const clampRatio = (value: number) => Math.max(minEdgeRatio, Math.min(maxEdgeRatio, value));
    const randomRange = (min: number, max: number) => min + Math.random() * (max - min);

    const getSpacedSingleRatio = () => {
      let ratio = clampRatio(randomRange(minEdgeRatio, maxEdgeRatio));
      let attempts = 0;
      while (Math.abs(ratio - lastSingleRatio) < 0.2 && attempts < 8) {
        ratio = clampRatio(randomRange(minEdgeRatio, maxEdgeRatio));
        attempts += 1;
      }
      lastSingleRatio = ratio;
      return ratio;
    };

    const pushSingle = () => {
      schedule.push({
        timeFromStartSeconds: elapsed,
        xRatio: getSpacedSingleRatio(),
      });
      elapsed += randomRange(2.1, 3.5);
    };

    const pushSymmetricCluster = () => {
      const center = randomRange(0.34, 0.66);
      const wingOffset = randomRange(0.12, 0.18);
      const left = clampRatio(center - wingOffset);
      const right = clampRatio(center + wingOffset);

      schedule.push({ timeFromStartSeconds: elapsed, xRatio: left });
      schedule.push({ timeFromStartSeconds: elapsed + 0.3, xRatio: center });
      schedule.push({ timeFromStartSeconds: elapsed + 0.6, xRatio: right });

      lastSingleRatio = center;
      elapsed += randomRange(4.0, 5.6);
    };

    while (schedule.length < this.level1MaxSpawns) {
      const remaining = this.level1MaxSpawns - schedule.length;
      const canPlaceCluster = remaining >= 3;
      const shouldPlaceCluster = canPlaceCluster && Math.random() < 0.18;

      if (shouldPlaceCluster) {
        pushSymmetricCluster();
      } else {
        pushSingle();
      }
    }

    schedule.sort((a, b) => a.timeFromStartSeconds - b.timeFromStartSeconds);
    return schedule.slice(0, this.level1MaxSpawns);
  }

  private startLevelEnding(): void {
    this.gameState = 'levelEnding';
    this.pauseLevelMusic();
    this.playVictoryMusic(true);
    this.isPlayerInputLocked = true;
    this.keysPressed.clear();
    this.bullets = [];
    this.fireCooldown = this.fireIntervalSeconds;
    this.playerSpriteDirection = 'center';
    this.isBoostingForward = true;
    this.levelEndingVelocityY = -this.levelEndingInitialSpeed;
    this.cdr.markForCheck();
  }

  private updateLevelEnding(deltaSeconds: number): void {
    this.levelEndingVelocityY -= this.levelEndingAcceleration * deltaSeconds;
    this.player.y += this.levelEndingVelocityY * deltaSeconds;

    const playerIsOffscreen = this.player.y + this.playerSpriteHeight / 2 < -24;
    if (!playerIsOffscreen) {
      return;
    }

    this.finishLevel();
  }

  private finishLevel(): void {
    this.gameState = 'levelComplete';
    this.isBoostingForward = false;
    this.levelEndingVelocityY = 0;
    this.player.y = -this.playerSpriteHeight;
    this.cdr.markForCheck();
  }

  private render(): void {
    if (!this.context) {
      return;
    }

    const ctx = this.context;

    this.drawBackground(ctx);
    this.drawEnemies(ctx);
    this.drawBullets(ctx);
    this.drawBoost(ctx);
    this.drawPlayer(ctx);
    this.drawHud(ctx);
  }

  private drawEnemies(ctx: CanvasRenderingContext2D): void {
    const enemySource = this.getEnemyFrameSource();
    const enemyWidth = enemySource
      ? this.getScaledWidthFromHeight(
          enemySource,
          this.enemySpriteHeight,
          this.enemySpriteFallbackWidth,
        )
      : this.enemySpriteFallbackWidth;

    if (this.enemyGifLoaded && enemySource) {
      for (const enemy of this.enemies) {
        ctx.drawImage(
          enemySource,
          enemy.x - enemyWidth / 2,
          enemy.y - this.enemySpriteHeight / 2,
          enemyWidth,
          this.enemySpriteHeight,
        );
      }
      return;
    }

    ctx.fillStyle = '#ff6f61';
    for (const enemy of this.enemies) {
      ctx.fillRect(
        enemy.x - enemyWidth / 2,
        enemy.y - this.enemySpriteHeight / 2,
        enemyWidth,
        this.enemySpriteHeight,
      );
    }
  }

  private drawBoost(ctx: CanvasRenderingContext2D): void {
    const direction = this.playerSpriteDirection;
    const isStrafeOnly = !this.isBoostingForward && direction !== 'center';

    if (!this.isBoostingForward && !isStrafeOnly) {
      return;
    }

    const boostY = this.player.y + this.playerSpriteHeight / 2 - 2;

    // When strafing without forward thrust: only the opposite side booster fires.
    const showCenter = this.isBoostingForward;
    const showLeftBoost = this.isBoostingForward ? direction !== 'left' : direction === 'right';
    const showRightBoost = this.isBoostingForward ? direction !== 'right' : direction === 'left';

    if (this.boostSpriteLoaded) {
      const centerWidth = this.boostSpriteWidth;
      const centerHeight = this.boostSpriteHeight;
      const sideWidth = Math.floor(this.boostSpriteWidth * 0.72);
      const sideHeight = Math.floor(this.boostSpriteHeight * 0.72);

      if (showLeftBoost) {
        ctx.drawImage(
          this.boostSprite,
          this.player.x - this.boostSideOffset - sideWidth / 2,
          boostY + 5,
          sideWidth,
          sideHeight,
        );
      }

      if (showCenter) {
        ctx.drawImage(
          this.boostSprite,
          this.player.x - centerWidth / 2,
          boostY,
          centerWidth,
          centerHeight,
        );
      }

      if (showRightBoost) {
        ctx.drawImage(
          this.boostSprite,
          this.player.x + this.boostSideOffset - sideWidth / 2,
          boostY + 5,
          sideWidth,
          sideHeight,
        );
      }

      return;
    }

    // Fallback flame while the boost sprite is still loading.
    const drawFallbackFlame = (x: number, y: number, size: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = 'rgba(0, 235, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size / 2, size * 1.7);
      ctx.lineTo(size / 2, size * 1.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    if (showLeftBoost) {
      drawFallbackFlame(this.player.x - this.boostSideOffset, boostY + 14, 7);
    }

    if (showCenter) {
      drawFallbackFlame(this.player.x, boostY + 12, 10);
    }

    if (showRightBoost) {
      drawFallbackFlame(this.player.x + this.boostSideOffset, boostY + 14, 7);
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D): void {
    if (this.backgroundSpriteLoaded) {
      const backgroundWidth = this.width * this.backgroundWidthScale;
      const hiddenWidth = backgroundWidth - this.width;
      const centeredX = -hiddenWidth / 2;
      const playerRatio = this.width > 0 ? this.player.x / this.width : 0.5;
      const parallaxShift = (playerRatio - 0.5) * hiddenWidth * this.backgroundParallaxStrength;
      const backgroundX = centeredX - parallaxShift;

      ctx.drawImage(this.backgroundSprite, backgroundX, this.backgroundScrollOffset, backgroundWidth, this.height);
      ctx.drawImage(
        this.backgroundSprite,
        backgroundX,
        this.backgroundScrollOffset - this.height,
        backgroundWidth,
        this.height,
      );
      return;
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#061124');
    gradient.addColorStop(1, '#091a33');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = 'rgba(0, 235, 255, 0.16)';
    ctx.lineWidth = 1;

    const spacing = 24;
    for (let x = 0; x <= this.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, this.height);
      ctx.stroke();
    }

    for (let y = 0; y <= this.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(this.width, y + 0.5);
      ctx.stroke();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    const activeSprite = this.playerSprites[this.playerSpriteDirection];

    if (this.playerSpriteLoaded[this.playerSpriteDirection]) {
      const drawWidth = this.getScaledWidthFromHeight(
        activeSprite,
        this.playerSpriteHeight,
        this.playerSpriteWidth,
      );
      ctx.drawImage(
        activeSprite,
        this.player.x - drawWidth / 2,
        this.player.y - this.playerSpriteHeight / 2,
        drawWidth,
        this.playerSpriteHeight,
      );
      return;
    }

    if (this.playerSpriteLoaded.center) {
      const drawWidth = this.getScaledWidthFromHeight(
        this.playerSprites.center,
        this.playerSpriteHeight,
        this.playerSpriteWidth,
      );
      ctx.drawImage(
        this.playerSprites.center,
        this.player.x - drawWidth / 2,
        this.player.y - this.playerSpriteHeight / 2,
        drawWidth,
        this.playerSpriteHeight,
      );
      return;
    }

    ctx.save();
    ctx.translate(this.player.x, this.player.y);
    ctx.rotate(-Math.PI / 2);

    ctx.fillStyle = '#f5c800';
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, 9);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-10, -9);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  private drawBullets(ctx: CanvasRenderingContext2D): void {
    if (this.fireSpriteLoaded) {
      const fireDrawWidth = this.getScaledWidthFromHeight(
        this.fireSprite,
        this.fireSpriteHeight,
        this.fireSpriteFallbackWidth,
      );
      for (const bullet of this.bullets) {
        ctx.drawImage(
          this.fireSprite,
          bullet.x - fireDrawWidth / 2,
          bullet.y - this.fireSpriteHeight / 2,
          fireDrawWidth,
          this.fireSpriteHeight,
        );
      }
      return;
    }

    ctx.fillStyle = '#00f5ac';
    for (const bullet of this.bullets) {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#7dffdf';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 255, 220, 0.45)';
    ctx.shadowBlur = 4;
    ctx.textAlign = 'left';

    const scoreText = `SCORE: ${this.score.toString().padStart(9, '0')}`;
    ctx.fillText(scoreText, 16, 16);
    ctx.fillText('Press ESC for Main Menu', 16, 36);
    ctx.fillText(`LEVEL ${this.levelNumber.toString().padStart(2, '0')}`, 16, 56);

    const hudRightX = this.width - 16;
    const shieldWarningAlpha = this.shields === 0 ? this.getWarningBlinkAlpha() : 1;
    const integrityWarningAlpha = this.integrity < 50 ? this.getWarningBlinkAlpha() : 1;

    ctx.globalAlpha = shieldWarningAlpha;
    ctx.textAlign = 'right';
    ctx.fillText('SHIELDS', hudRightX, 16);

    const shieldBlockWidth = 22;
    const shieldBlockHeight = 9;
    const shieldBlockGap = 5;
    const totalShieldWidth =
      this.maxShields * shieldBlockWidth + (this.maxShields - 1) * shieldBlockGap;
    const shieldStartX = hudRightX - totalShieldWidth;

    for (let i = 0; i < this.maxShields; i += 1) {
      const blockX = shieldStartX + i * (shieldBlockWidth + shieldBlockGap);
      const blockY = 31;

      ctx.fillStyle = i < this.shields ? '#53f7ff' : 'rgba(83, 247, 255, 0.15)';
      ctx.fillRect(blockX, blockY, shieldBlockWidth, shieldBlockHeight);
      ctx.strokeStyle = 'rgba(0, 255, 220, 0.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(blockX + 0.5, blockY + 0.5, shieldBlockWidth - 1, shieldBlockHeight - 1);
    }

    ctx.globalAlpha = integrityWarningAlpha;
    ctx.fillStyle = '#7dffdf';
    const integrityText = `INTEGRITY: ${this.integrity.toString().padStart(3, '0')}%`;
    ctx.fillText(integrityText, hudRightX, 49);

    ctx.restore();
  }

  private getWarningBlinkAlpha(): number {
    const phase = Math.sin((this.enemyAnimationClockMs / 1400) * Math.PI * 2);
    return 0.35 + ((phase + 1) / 2) * 0.65;
  }

  private playLevelMusic(restart: boolean): void {
    if (!this.musicEnabled) {
      return;
    }

    this.pauseVictoryMusic();

    if (restart) {
      this.levelMusic.currentTime = 0;
    }

    void this.levelMusic.play().catch(() => {
      // Browser autoplay policies may defer playback until explicit user interaction.
    });
  }

  private pauseLevelMusic(): void {
    this.levelMusic.pause();
  }

  private stopLevelMusic(): void {
    this.levelMusic.pause();
    this.levelMusic.currentTime = 0;
  }

  private playVictoryMusic(restart: boolean): void {
    if (!this.musicEnabled) {
      return;
    }

    this.pauseLevelMusic();

    if (restart) {
      this.victoryMusic.currentTime = 0;
    }

    void this.victoryMusic.play().catch(() => {
      // Browser autoplay policies may defer playback until explicit user interaction.
      this.retryVictoryOnNextGesture = true;
    });
  }

  private pauseVictoryMusic(): void {
    this.victoryMusic.pause();
  }

  private stopVictoryMusic(): void {
    this.retryVictoryOnNextGesture = false;
    this.victoryMusic.pause();
    this.victoryMusic.currentTime = 0;
  }

  private loadPlayerSprite(): void {
    this.loadSprite('center', '/assets/shooter/player_1.png');
    this.loadSprite('left', '/assets/shooter/player_1L.png');
    this.loadSprite('right', '/assets/shooter/player_1R.png');

    this.backgroundSprite.addEventListener(
      'load',
      () => {
        this.backgroundSpriteLoaded = true;
      },
      { once: true },
    );

    this.backgroundSprite.src = '/assets/shooter/bg1.png';

    if (this.backgroundSprite.complete && this.backgroundSprite.naturalWidth > 0) {
      this.backgroundSpriteLoaded = true;
    }

    this.boostSprite.addEventListener(
      'load',
      () => {
        this.boostSpriteLoaded = true;
      },
      { once: true },
    );

    this.boostSprite.src = '/assets/shooter/boost1.png';

    if (this.boostSprite.complete && this.boostSprite.naturalWidth > 0) {
      this.boostSpriteLoaded = true;
    }

    this.fireSprite.addEventListener('load', () => { this.fireSpriteLoaded = true; }, { once: true });
    this.fireSprite.src = '/assets/shooter/fire1.png';

    if (this.fireSprite.complete && this.fireSprite.naturalWidth > 0) {
      this.fireSpriteLoaded = true;
    }
  }

  private async loadEnemyAnimationFrames(): Promise<void> {
    try {
      const ImageDecoderCtor = (window as {
        ImageDecoder?: new (options: { data: ArrayBuffer; type: string }) => {
          tracks?: {
            ready?: Promise<unknown>;
            selectedTrack?: { frameCount?: number };
          };
          decode: (options: { frameIndex: number }) => Promise<{
            image: {
              duration?: number;
              close?: () => void;
            };
          }>;
          close?: () => void;
        };
      }).ImageDecoder;

      if (!ImageDecoderCtor) {
        return;
      }

      const response = await fetch('/assets/shooter/enemy1.gif');
      if (!response.ok) {
        return;
      }

      const data = await response.arrayBuffer();
      const decoder = new ImageDecoderCtor({ data, type: 'image/gif' });

      if (decoder.tracks?.ready) {
        await decoder.tracks.ready;
      }

      const frameCount = Math.max(1, decoder.tracks?.selectedTrack?.frameCount ?? 1);
      const decodedFrames: ImageBitmap[] = [];
      let frameDurationMs = this.enemyAnimationFrameDurationMs;

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const result = await decoder.decode({ frameIndex });
        const decodedFrame = result.image as unknown as ImageBitmap & {
          duration?: number;
          close?: () => void;
        };
        const bitmap = await createImageBitmap(decodedFrame);
        decodedFrames.push(bitmap);

        if (frameIndex === 0 && decodedFrame.duration && decodedFrame.duration > 0) {
          frameDurationMs = Math.max(16, Math.round(decodedFrame.duration / 1000));
        }

        decodedFrame.close?.();
      }

      decoder.close?.();

      if (decodedFrames.length > 0) {
        this.enemyAnimationFrames = decodedFrames;
        this.enemyAnimationFrameDurationMs = frameDurationMs;
        this.enemyGifLoaded = true;
      }
    } catch {
      // Keep fallback rectangle rendering if GIF decoding is unavailable.
    }
  }

  private getEnemyFrameSource(): CanvasImageSource | null {
    if (this.enemyAnimationFrames.length === 0) {
      return null;
    }

    const frameIndex = Math.floor(
      this.enemyAnimationClockMs / this.enemyAnimationFrameDurationMs,
    ) % this.enemyAnimationFrames.length;

    return this.enemyAnimationFrames[frameIndex];
  }

  private loadSprite(direction: PlayerSpriteDirection, source: string): void {
    const sprite = this.playerSprites[direction];

    sprite.addEventListener(
      'load',
      () => {
        this.playerSpriteLoaded[direction] = true;
      },
      { once: true },
    );

    sprite.src = source;

    if (sprite.complete && sprite.naturalWidth > 0) {
      this.playerSpriteLoaded[direction] = true;
    }
  }

  private getScaledWidthFromHeight(
    sprite: CanvasImageSource,
    targetHeight: number,
    fallbackWidth: number,
  ): number {
    const source = sprite as {
      naturalWidth?: number;
      naturalHeight?: number;
      width?: number;
      height?: number;
    };

    const width = source.naturalWidth ?? source.width ?? 0;
    const height = source.naturalHeight ?? source.height ?? 0;

    if (width > 0 && height > 0) {
      return Math.max(1, Math.round((width / height) * targetHeight));
    }

    return fallbackWidth;
  }

  private resizeCanvas(initialPlacement = false): void {
    const canvas = this.gameCanvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    const nextCanvasWidth = Math.floor(rect.width * devicePixelRatio);
    const nextCanvasHeight = Math.floor(rect.height * devicePixelRatio);

    this.width = rect.width;
    this.height = rect.height;

    if (canvas.width !== nextCanvasWidth || canvas.height !== nextCanvasHeight) {
      canvas.width = nextCanvasWidth;
      canvas.height = nextCanvasHeight;
    }

    if (!this.context) {
      return;
    }

    this.context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    if (initialPlacement || this.player.x === 0) {
      this.player.x = this.width / 2;
    } else {
      this.player.x = Math.max(this.player.radius, Math.min(this.width - this.player.radius, this.player.x));
    }

    if (initialPlacement || this.player.y === 0) {
      this.player.y = this.height - this.playerBottomOffset - this.player.radius;
    } else {
      this.player.y = Math.max(this.player.radius, Math.min(this.height - this.player.radius, this.player.y));
    }
  }
}
