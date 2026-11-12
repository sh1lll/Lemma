import { didHandler, ivHandler, kalmanHandler, panelHandler, rddHandler } from './models-econ';
import { logistic, multipleRegression, nonlinear, polynomial, simpleInference } from './models-reg';
import {
  acfHandler, adfHandler, arimaHandler, cointegrationHandler, garchHandler, grangerHandler, movingAverageHandler, smoothingHandler, varHandler,
} from './models-ts';
import type { PHandler } from './util';

// Regression models and diagnostics, time series and econometrics. Specific designs first (panels, IV, DiD, RDD),
// then time-series models, then regression variants; plain multiple regression last.
export const HANDLERS: PHandler[] = [
  panelHandler,
  ivHandler,
  didHandler,
  rddHandler,
  kalmanHandler,
  garchHandler,
  varHandler,
  grangerHandler,
  cointegrationHandler,
  adfHandler,
  arimaHandler,
  smoothingHandler,
  movingAverageHandler,
  acfHandler,
  logistic,
  nonlinear,
  polynomial,
  simpleInference,
  multipleRegression,
];
