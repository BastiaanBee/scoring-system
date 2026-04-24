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

type PlayerSpriteDirection = 'center' | 'left' | 'right';
type GameState = 'menu' | 'playing' | 'paused';

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

  private readonly bulletSpeed = 500;
  private readonly fireIntervalSeconds = 0.12;
  private readonly enemySpawnIntervalSeconds = 2.8;
  private readonly enemySpeed = 72;
  private readonly enemyHitPoints = 5;
  private readonly enemyKillScore = 1000;
  private readonly playerBottomOffset = 28;
  private enemySpawnTimer = this.enemySpawnIntervalSeconds;

  private readonly onWindowResize = () => {
    this.resizeCanvas();
  };

  private readonly onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.code === 'Escape') {
      event.preventDefault();
      if (this.gameState === 'playing') {
        this.keysPressed.clear();
        this.gameState = 'paused';
        this.menuFocusIndex = 0;
        this.cdr.markForCheck();
      } else if (this.gameState === 'paused') {
        this.gameState = 'playing';
        this.lastTimestamp = 0;
        this.cdr.markForCheck();
      }
      return;
    }

    if (this.gameState !== 'playing') {
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

    this.keysPressed.add(event.code);

    if (event.code === 'Space') {
      event.preventDefault();
    }
  };

  private readonly onWindowKeyUp = (event: KeyboardEvent) => {
    this.keysPressed.delete(event.code);
  };

  goHome(): void {
    this.router.navigate(['/']);
  }

  startNewGame(): void {
    this.bullets = [];
    this.enemies = [];
    this.score = 0;
    this.enemySpawnTimer = this.enemySpawnIntervalSeconds;
    this.fireCooldown = 0;
    this.lastTimestamp = 0;
    this.player.x = this.width / 2;
    this.player.y = this.height - this.playerBottomOffset - this.player.radius;
    this.keysPressed.clear();
    this.helpOpen = false;
    this.gameState = 'playing';
  }

  loadGame(): void {
    // Not yet implemented.
  }

  resumeGame(): void {
    this.gameState = 'playing';
    this.lastTimestamp = 0;
    this.cdr.markForCheck();
  }

  returnToMainMenu(): void {
    this.bullets = [];
    this.enemies = [];
    this.score = 0;
    this.enemySpawnTimer = this.enemySpawnIntervalSeconds;
    this.keysPressed.clear();
    this.helpOpen = false;
    this.menuFocusIndex = 0;
    this.gameState = 'menu';
    this.cdr.markForCheck();
  }

  toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    this.menuFocusIndex = 0;
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
        { action: () => this.startNewGame() },
        { action: () => this.toggleHelp() },
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
  }

  private detachInputListeners(): void {
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    window.removeEventListener('keyup', this.onWindowKeyUp);
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
    if (this.gameState !== 'playing') {
      return;
    }

    this.backgroundScrollOffset =
      (this.backgroundScrollOffset + this.backgroundScrollSpeed * deltaSeconds) % this.height;

    this.updatePlayer(deltaSeconds);

    this.fireCooldown = Math.max(0, this.fireCooldown - deltaSeconds);
    if (this.keysPressed.has('Space')) {
      this.tryFire();
    }

    this.enemyAnimationClockMs += deltaSeconds * 1000;

    this.updateBullets(deltaSeconds);
    this.updateEnemies(deltaSeconds);
    this.handleProjectileEnemyCollisions();
  }

  private updatePlayer(deltaSeconds: number): void {
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
    this.enemySpawnTimer -= deltaSeconds;
    while (this.enemySpawnTimer <= 0) {
      this.spawnEnemy();
      this.enemySpawnTimer += this.enemySpawnIntervalSeconds;
    }

    this.enemies = this.enemies
      .map((enemy) => ({
        ...enemy,
        y: enemy.y + enemy.vy * deltaSeconds,
      }))
      .filter((enemy) => enemy.y - this.enemySpriteHeight / 2 <= this.height + 20);
  }

  private spawnEnemy(): void {
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
    const spawnX = minX + Math.random() * (maxX - minX);

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

    const scoreText = `SCORE: ${this.score.toString().padStart(9, '0')}`;
    ctx.fillText(scoreText, 16, 16);
    ctx.fillText('Press ESC for Main Menu', 16, 36);
    ctx.fillText('LEVEL 01', 16, 56);

    ctx.restore();
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
