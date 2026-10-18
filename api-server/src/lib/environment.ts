import dotenv from 'dotenv'
import { existsSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'

export function loadEnvironment() {
    let directory = __dirname
    while (true) {
        const file = join(directory, '.env')
        if (existsSync(file)) {
            dotenv.config({ path: file })
            const key = process.env.GITHUB_APP_PRIVATE_KEY_PATH
            if (key && !isAbsolute(key)) process.env.GITHUB_APP_PRIVATE_KEY_PATH = resolve(directory, key)
            return
        }
        const parent = dirname(directory)
        if (parent === directory) return
        directory = parent
    }
}
