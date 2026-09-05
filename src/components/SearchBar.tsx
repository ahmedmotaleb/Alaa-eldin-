import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

export function SearchBar() {
  const [term, setTerm] = useState('')
  const navigate = useNavigate()

  function submit(e: FormEvent) {
    e.preventDefault()
    const q = term.trim()
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <form className="search-bar" onSubmit={submit}>
      <span>⌕</span>
      <input
        value={term}
        onChange={e => setTerm(e.target.value)}
        placeholder="ابحث عن منتج..."
        aria-label="ابحث عن منتج"
      />
      <button type="submit">بحث</button>
    </form>
  )
}
