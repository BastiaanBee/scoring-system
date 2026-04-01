// app.routes.ts — defines the two routes: homepage and contest
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home.component').then(m => m.HomeComponent) },
  { path: 'contest', loadComponent: () => import('./app').then(m => m.App) },
];