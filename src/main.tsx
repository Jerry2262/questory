import { createRoot } from 'react-dom/client'

import TreeApp from './TreeApp'
import './styles.css'
import './tree.css'

createRoot(document.getElementById('root')!).render(<TreeApp />)
