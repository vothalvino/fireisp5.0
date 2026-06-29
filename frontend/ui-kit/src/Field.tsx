import React, { useState, useId } from 'react';

/**
 * Labeled form field wrapping a native <input>. Handles focus ring,
 * error state (red border + message), hint text, required marker,
 * and disabled styling — all driven by FireISP design tokens.
 */
export interface FieldProps {
  /** Visible label shown above the input. */
  label: string;
  /** Controlled value. */
  value: string;
  /** Called on every keystroke. */
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** HTML input type. @default 'text' */
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  /** Validation error message — renders below the input in danger colour. */
  error?: string;
  /** Supplementary help text shown below the input (hidden when error is set). */
  hint?: string;
  /** Appends a required asterisk to the label. @default false */
  required?: boolean;
  disabled?: boolean;
  /** Explicit id for the input; auto-generated when omitted. */
  id?: string;
  style?: React.CSSProperties;
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  hint,
  required = false,
  disabled = false,
  id: idProp,
  style,
}: FieldProps): React.ReactElement {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [focused, setFocused] = useState(false);

  const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--sp-1)',
    fontFamily: 'var(--font-sans)',
    ...style,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.82rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  };

  const requiredStyle: React.CSSProperties = {
    color: 'var(--danger)',
    marginLeft: '2px',
  };

  const inputBorderColor = error
    ? 'var(--danger)'
    : focused
    ? 'var(--accent)'
    : 'var(--input-border)';

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: 'var(--sp-2) var(--sp-3)',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.85rem',
    color: 'var(--text-primary)',
    background: disabled ? 'var(--bg-subtle)' : 'var(--input-bg)',
    border: `1px solid ${inputBorderColor}`,
    borderRadius: 'var(--radius-md)',
    outline: 'none',
    boxShadow: focused ? '0 0 0 3px var(--focus-ring)' : 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    cursor: disabled ? 'not-allowed' : 'text',
    opacity: disabled ? 0.7 : 1,
    boxSizing: 'border-box',
  };

  const errorStyle: React.CSSProperties = {
    fontSize: '0.78rem',
    color: 'var(--danger)',
    lineHeight: 1.4,
  };

  const hintStyle: React.CSSProperties = {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    lineHeight: 1.4,
  };

  return (
    <div style={wrapperStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
        {required && <span style={requiredStyle} aria-hidden="true">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        style={inputStyle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
      {error && (
        <span id={`${id}-error`} role="alert" style={errorStyle}>
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={`${id}-hint`} style={hintStyle}>
          {hint}
        </span>
      )}
    </div>
  );
}
