import React, { useId } from 'react';

export function ToggleSwitch({ checked, onChange, disabled = false, ariaLabel, className = '' }) {
  const id = useId();

  return (
    <div className={`pixflow-toggle-cont ${disabled ? 'is-disabled' : ''} ${className}`.trim()}>
      <input
        className="pixflow-toggle-input"
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange?.(event.target.checked, event)}
      />
      <label className="pixflow-toggle-label" htmlFor={id}>
        <div className="pixflow-toggle-knob-wrap">
          <span className="pixflow-toggle-knob-icon" />
        </div>
      </label>
    </div>
  );
}
