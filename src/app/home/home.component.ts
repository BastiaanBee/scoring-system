// home.component.ts — homepage component
import { Component, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  encapsulation: ViewEncapsulation.None
})

export class HomeComponent {
  currentYear = new Date().getFullYear();

  constructor(private router: Router) {}

  start() {
    this.router.navigate(['/contest']);
  }

  openShooter() {
    this.router.navigate(['/shooter']);
  }
}