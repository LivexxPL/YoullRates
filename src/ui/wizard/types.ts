import type { Dispatch } from 'react';
import type { Action, AppState, Derived } from '../state/useTuneState';

export interface StepProps extends Derived {
  state: AppState;
  dispatch: Dispatch<Action>;
}
