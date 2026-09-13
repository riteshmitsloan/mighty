import type {Goal} from '../lib/goals';
import './GoalsPanel.css';

export type GoalSwitcherProps = {
  goals: readonly Goal[];
  activeGoalId: string | null;
  onSelect: (id: string) => void;
  busy?: boolean;
};

export default function GoalSwitcher({goals, activeGoalId, onSelect, busy = false}: GoalSwitcherProps) {
  const available = goals.filter(goal => goal.status === 'active');
  if (!available.length) return null;
  return <div className="goal-switcher" role="group" aria-label="Choose your active goal">
    {available.map(goal => <button key={goal.id} type="button" className={`goal-chip ${goal.id === activeGoalId ? 'is-selected' : ''}`} aria-pressed={goal.id === activeGoalId} disabled={busy} onClick={() => {if (!busy && goal.id !== activeGoalId) onSelect(goal.id);}}>
      <span className="goal-chip-dot" aria-hidden="true"/><span>{goal.title}</span>
    </button>)}
  </div>;
}
