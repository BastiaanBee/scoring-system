// app.routes.ts — defines all routes for the app
import { Routes } from '@angular/router';

export const routes: Routes = [
  // Homepage — tile selector
  { path: '', loadComponent: () => import('./home/home.component').then(m => m.HomeComponent) },
  // Contest page — main scoring app
  { path: 'contest', loadComponent: () => import('./app').then(m => m.App) },
  // Shooter page — top-down retro prototype
  { path: 'shooter', loadComponent: () => import('./shooter/shooter.component').then(m => m.ShooterComponent) },
  // Snapshot page — read-only reveal for a specific voting round
  { path: 'snapshot/:id', loadComponent: () => import('./snapshot/snapshot.component').then(m => m.SnapshotComponent) },
];