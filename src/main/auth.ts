import jwtDecode from 'jwt-decode'
import {shell} from 'electron'
import * as url from 'url'
// import envVariables from '../env-variables';
import {
    BrowserView,
    BrowserWindow,
    ipcMain,
    IpcMainInvokeEvent,
    webContents,
} from 'electron'
import { API_ROOT } from '../utils'
import crypto from 'crypto'
import fetch from 'node-fetch'

import Store from 'electron-store'
const store = new Store()

let win: BrowserWindow | null = null

const auth0Domain = 'cursor.us.auth0.com'
const clientId = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB'
const cursorHome = 'https://cursor.so'

// Test domain/client
// const auth0Domain = 'dev-27d5cph2nbetfllb.us.auth0.com'
// const clientId = 'OzaBXLClY5CAGxNzUhQ2vlknpi07tGuE'
// const cursorHome = 'http://localhost:4000'

let accessToken: string | null = null
let profile: any | null = null
let openAISecretKey: string | null = null
let refreshToken: string | null = null
let stripeProfile: string | null = null
let verifier: string | null = null

const STRIPE_SUCCESS_URL = 'electron-fiddle://success/'
const STRIPE_FAILURE_URL = 'electron-fiddle://failure/'

const AUTH0_CALLBACK_URL = `${API_ROOT}/auth/auth0_callback`
const redirectUri = AUTH0_CALLBACK_URL
const DUMMY_URL = `${API_ROOT}/dummy/*`
const API_AUDIENCE = `https://${auth0Domain}/api/v2/`

// These are routes that exist on our homepage
const loginUrl = `${cursorHome}/api/auth/loginDeep`
const signUpUrl = `${cursorHome}/api/auth/loginDeep`
const settingsUrl = `${cursorHome}/settings`
const supportUrl = `${API_ROOT}/auth/support`

// These are api routes
const logoutUrl = `${API_ROOT}/api/auth/logout`
const payUrl = `${API_ROOT}/api/auth/checkoutDeep`

const storeWrapper = {
    get: async (key: string) => {
        return store.get('AUTH_STORE_' + key)
    },
    set: async (key: string, value: any) => {
        return store.set('AUTH_STORE_' + key, value)
    },
    has: async (key: string) => {
        return store.has('AUTH_STORE_' + key)
    },
    delete: async (key: string) => {
        return store.delete('AUTH_STORE_' + key)
    },
    clear: async () => {
        // Iterate through the keys of store that should be deleted and remove
        Object.keys(store.store).forEach((key) => {
            if (key.startsWith('AUTH_STORE_')) {
                store.delete(key)
            }
        })
    },
}

function base64URLEncode(str: Buffer) {
    return str
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
}
function sha256(buffer: Buffer) {
    return crypto.createHash('sha256').update(buffer).digest()
}

export async function stripeUrlRequest(window: BrowserWindow) {
    const response = await fetch(`${API_ROOT}/auth/create-checkout-session`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
            profile,
        }),
    })

    const newUrl = (await response.json()) as string
    console.log('GOT NEW URL', { newUrl })
    window.loadURL(newUrl)
}

export async function refreshTokens(event?: IpcMainInvokeEvent) {
    const refreshToken = await storeWrapper.get('refreshToken')
    console.log('retrieving refreshToken', refreshToken)

    if (refreshToken) {
        const refreshOptions = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'refresh_token',
                client_id: clientId,
                refresh_token: refreshToken,
                // audience: API_AUDIENCE,
                // state: 'thisisatest',
            }),
        }
        try {
            const response = await fetch(
                `https://${auth0Domain}/oauth/token`,
                refreshOptions
            )
            console.log('resp', response)
            console.log(response.status)
            const origData = await response.json()
            console.log('Orig data', origData)
            const data = origData as {
                access_token: string
                id_token: string
            }

            accessToken = data.access_token
            console.log('GETTING BACK PROFILE', data.id_token)
            profile = jwtDecode(data.id_token)
        } catch (error) {
            // await logout(parentWindow)
            throw error
        }
    } else {
        // No refresh token
        //throw new Error('No available refresh token.')
    }

    console.log('UPDATING AUTH STATUS IN refresh tokens')
    if (event) {
        event.sender.send('updateAuthStatus', { accessToken, profile })
    }
}

export async function setupTokens(
    callbackURL: string,
    // window: BrowserWindow
) {
    const urlParts = url.parse(callbackURL, true)
    const query = urlParts.query
    const host = urlParts.host
    //
    if (host?.toLowerCase() === 'changetokens') {
        console.log('settings access and refresh')
        accessToken = query.accessToken as string
        refreshToken = query.refreshToken as string
        console.log('storing refreshToken', refreshToken)

        await storeWrapper.set('refreshToken', refreshToken)
    }
    // Get the profile id from this
    await refreshTokens()
    await loadStripeProfile()
    webContents.getAllWebContents().forEach((wc) => {
        wc.send('updateAuthStatus', { accessToken, profile, stripeProfile })
    })

}

export async function loadStripeProfile() {
    if (!accessToken) {
        return
    }

    const response = await fetch(`${API_ROOT}/auth/stripe_profile`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    })
    let resp = await response.json()
    console.log('GOT STRIPE PROFILE', resp)
    if (resp) {
        stripeProfile = resp as string
    }
}

export async function logout(window: BrowserWindow) {
    await storeWrapper.clear()
    accessToken = null
    profile = null
    refreshToken = null
    stripeProfile = null
    window.webContents.send('updateAuthStatus', {
        accessToken,
        profile,
        stripeProfile,
    })
}

export async function logoutEvent(event: IpcMainInvokeEvent) {
    await storeWrapper.clear()
    accessToken = null
    profile = null
    refreshToken = null
    stripeProfile = null
    event.sender.send('updateAuthStatus', {
        accessToken,
        profile,
        stripeProfile,
    })
}

export function getLogOutUrl() {
    return `https://${auth0Domain}/v2/logout`
}

export async function login() {
    // const { url, state, } = getAuthenticationURL()
    await shell.openExternal(loginUrl);
}

export async function signup() {
    await shell.openExternal(signUpUrl);
}

export async function pay() {
    await shell.openExternal(payUrl);
}
export async function settings() {
    await shell.openExternal(settingsUrl);
}
export async function support() {
    await shell.openExternal(supportUrl);
}

export function createLogoutWindow(event: IpcMainInvokeEvent) {
    console.log('LOGGING OUT')
    const logoutWindow = new BrowserWindow({
        show: false,
    })

    logoutWindow.loadURL(getLogOutUrl())

    logoutWindow.on('ready-to-show', async () => {
        console.log('CLOSING LOGOUT WINDOW')
        await logoutEvent(event)
        logoutWindow.close()
    })
}

export function authPackage() {
    // Simple browser opening functions
    ipcMain.handle('loginCursor', login);
    ipcMain.handle('signupCursor', signup)
    ipcMain.handle('payCursor', pay)
    ipcMain.handle('settingsCursor', settings)
    ipcMain.handle('logoutCursor', createLogoutWindow)

    // Functions to handle electron-fiddle
    ipcMain.handle('loginData', async (event: IpcMainInvokeEvent, data: {
        accessToken: string
        profile: any
        stripeProfile: string
    }) => {
        // Set the global values
        accessToken = data.accessToken
        profile = data.profile
        stripeProfile = data.stripeProfile
        await refreshTokens(event)
        await loadStripeProfile()

        event.sender.send('updateAuthStatus', {
            accessToken,
            profile,
            stripeProfile,
        })
    })
        
    ipcMain.handle('refreshTokens', async (event: IpcMainInvokeEvent) => {
        await refreshTokens(event)
        await loadStripeProfile()

        event.sender.send('updateAuthStatus', {
            accessToken,
            profile,
            stripeProfile,
        })
    })

    ipcMain.handle('getUserCreds', async (event: IpcMainInvokeEvent) => {
        await refreshTokens(event)
        await loadStripeProfile()
        return {
            accessToken,
            profile,
            stripeProfile,
        }
    })
}