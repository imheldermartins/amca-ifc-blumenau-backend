import { cpSync, mkdirSync } from 'node:fs'

const source = new URL('../src/services/mail/templates/', import.meta.url)
const destination = new URL('../dist/services/mail/templates/', import.meta.url)
mkdirSync(destination, { recursive: true })
cpSync(source, destination, { recursive: true })
