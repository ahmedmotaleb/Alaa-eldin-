import { useId, useState } from 'react'

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  placeholder?: string
  helpText?: string
}

// حقل كلمة مرور موحّد: بيسمح باللصق ومدراء كلمات المرور (autoComplete صحيح + input عادي
// من غير أي منع للصق)، وما بيقصّش الطول بصمت، ومعاه زر إظهار/إخفاء يقدر يستخدمه أي مستخدم
// عنده صعوبة في كتابة كلمة مرور طويلة على الموبايل من غير ما يشوفها.
export function PasswordField({ label, value, onChange, autoComplete, placeholder, helpText }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const id = useId()

  return (
    <label htmlFor={id}>
      {label}
      <span className="password-field">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="password-field-toggle"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
          aria-pressed={visible}
        >
          {visible ? '🙈' : '👁️'}
        </button>
      </span>
      {helpText && <span className="password-field-help">{helpText}</span>}
    </label>
  )
}
