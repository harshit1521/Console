import { useState, useEffect } from "react"
import ConsoleIDE from "./ConsoleIDE.tsx"

const App = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  return (
    <div className="h-screen overflow-hidden bg-bg text-text transition-colors duration-200">
      <ConsoleIDE isDark={isDark} onToggleTheme={() => setIsDark(!isDark)} />
    </div>
  )
}

export default App