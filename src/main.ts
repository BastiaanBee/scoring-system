import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { provideRouter } from '@angular/router';
import { ShellComponent } from './app/shell.component';

bootstrapApplication(ShellComponent, appConfig)
  .catch((err) => console.error(err));
