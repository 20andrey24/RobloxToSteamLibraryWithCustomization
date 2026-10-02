const path = require('path');
const fs = require('fs');
const axios = require('axios');
const shortcut = require('steam-shortcut-editor');
const pngToIco = require('png-to-ico');
const CRC32 = require('crc-32');
const sharp = require('sharp');

function findSteamUserDir() {
    const steamPath = 'C:\\Program Files (x86)\\Steam\\userdata';
    if (!fs.existsSync(steamPath)) {
        return null;
    }
    const dirs = fs.readdirSync(steamPath).filter(f => fs.statSync(path.join(steamPath, f)).isDirectory());
    if (dirs.length === 0) return null;
    return path.join(steamPath, dirs[0]);
}

function generateAppIdUnsigned(exe, appName) {
    const cleanExe = exe.replace(/^"+|"+$/g, '');
    const crc = CRC32.str(cleanExe + appName) >>> 0;
    return (crc | 0x80000000) >>> 0;
}

function toSigned32(unsignedValue) {
    return unsignedValue > 0x7FFFFFFF ? unsignedValue - 0x100000000 : unsignedValue;
}

function toUnsigned32(value) {
    return value < 0 ? value + 0x100000000 : value;
}

async function downloadAndSaveTemp(url, destPath) {
    const resp = await axios({ method: 'get', url, responseType: 'stream' });
    const writer = fs.createWriteStream(destPath);
    resp.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Делает из любой картинки портретный тайл 600x900 ("основное изображение" библиотеки Steam),
// вписывая оригинал целиком на чёрный фон, и сжимает PNG для меньшего размера файла.
async function createPortraitCapsule(sourceImagePath, destPath) {
    await sharp(sourceImagePath)
        .resize(600, 900, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 1 }
        })
        .png({ quality: 85, compressionLevel: 9 })
        .toFile(destPath);
}

function copyArtworkToGrid(appIdUnsigned, gameDir, gridDir) {
    if (!fs.existsSync(gridDir)) {
        fs.mkdirSync(gridDir, { recursive: true });
    }
    const heroLocal = path.join(gameDir, 'hero.png');
    const logoLocal = path.join(gameDir, 'logo.png');
    const capsuleLocal = path.join(gameDir, 'capsule.png');

    if (fs.existsSync(heroLocal)) {
        fs.copyFileSync(heroLocal, path.join(gridDir, `${appIdUnsigned}_hero.png`));
        console.log(`Фон скопирован как: ${appIdUnsigned}_hero.png`);
    }
    if (fs.existsSync(logoLocal)) {
        fs.copyFileSync(logoLocal, path.join(gridDir, `${appIdUnsigned}_logo.png`));
        console.log(`Логотип скопирован как: ${appIdUnsigned}_logo.png`);
    }
    if (fs.existsSync(capsuleLocal)) {
        fs.copyFileSync(capsuleLocal, path.join(gridDir, `${appIdUnsigned}p.png`));
        console.log(`Основное изображение скопировано как: ${appIdUnsigned}p.png`);
    }
}

async function addToSteam(targetUrl) {
    try {
        const placeIdMatch = targetUrl.match(/[0-9]+/);
        if (!placeIdMatch) {
            throw new Error('Could not find place ID in URL');
        }
        const placeId = placeIdMatch[0];

        console.log(`Fetching game info for Place ID: ${placeId}...`);

        const universeIdResponse = await axios.get(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
        const universeId = universeIdResponse.data.universeId;

        const gameNameResponse = await axios.get(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
        const gameName = gameNameResponse.data.data[0].name.replace(/[^a-zA-Z0-9 ]/g, "").trim();

        console.log(`Game Name: ${gameName}`);

        const baseDir = path.join(process.cwd(), 'gamefile');
        const gameDir = path.join(baseDir, gameName);
        if (!fs.existsSync(gameDir)) {
            fs.mkdirSync(gameDir, { recursive: true });
        }

        const userDir = findSteamUserDir();
        if (!userDir) {
            throw new Error('Could not find Steam userdata directory. Is Steam installed in the default location?');
        }
        const shortcutsPath = path.join(userDir, 'config', 'shortcuts.vdf');
        const gridDir = path.join(userDir, 'config', 'grid');

        let shortcuts = { shortcuts: [] };
        if (fs.existsSync(shortcutsPath)) {
            const buffer = fs.readFileSync(shortcutsPath);
            shortcuts = shortcut.parseBuffer(buffer);
        }

        const launcherPath = path.join(gameDir, 'steamLauncher.js');
        const sourceLauncherPath = path.join(__dirname, 'steamLauncher.js');
        fs.copyFileSync(sourceLauncherPath, launcherPath);

        const launchOptions = `"${launcherPath}" ${placeId}`;
        const exe = `"${process.execPath}"`;
        const existingEntry = shortcuts.shortcuts.find(s => s.AppName === gameName && s.LaunchOptions === launchOptions);

        if (existingEntry) {
            let appIdUnsigned;
            if (existingEntry.appid !== undefined && existingEntry.appid !== null) {
                appIdUnsigned = toUnsigned32(existingEntry.appid);
                console.log(`Shortcut уже существует. Appid из файла: ${existingEntry.appid} (без знака: ${appIdUnsigned})`);
            } else {
                appIdUnsigned = generateAppIdUnsigned(existingEntry.Exe, existingEntry.AppName);
                existingEntry.appid = toSigned32(appIdUnsigned);
                const fixedBuffer = shortcut.writeBuffer(shortcuts);
                fs.writeFileSync(shortcutsPath, fixedBuffer);
                console.log(`Поле appid было пустым, записала своё значение: ${appIdUnsigned}`);
            }
            copyArtworkToGrid(appIdUnsigned, gameDir, gridDir);
            console.log('Готово. Перезапусти Steam полностью (через Диспетчер задач), чтобы увидеть обложки.');
            return;
        }

        const iconUrlResponse = await axios.get(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false`);
        const iconUrl = iconUrlResponse.data.data[0].imageUrl;

        const iconPath = path.join(gameDir, 'icon.ico');
        console.log('Downloading icon...');
        const tempPngPath = path.join(gameDir, 'temp.png');
        await downloadAndSaveTemp(iconUrl, tempPngPath);
        const buf = await pngToIco(tempPngPath);
        fs.writeFileSync(iconPath, buf);
        console.log(`Icon saved to: ${iconPath}`);

        try {
            const thumbResp = await axios.get(
                `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&countPerUniverse=5&size=768x432&format=Png&isCircular=false`
            );
            const thumbs = thumbResp.data?.data?.[0]?.thumbnails;
            if (thumbs && thumbs.length) {
                await downloadAndSaveTemp(thumbs[0].imageUrl, path.join(gameDir, 'hero.png'));
                console.log(`Фон сохранён в: ${path.join(gameDir, 'hero.png')}`);
            }
        } catch (e) {
            console.error('Не удалось скачать фон:', e.message);
        }

        try {
            await downloadAndSaveTemp(iconUrl, path.join(gameDir, 'logo.png'));
            console.log(`Логотип сохранён в: ${path.join(gameDir, 'logo.png')}`);
        } catch (e) {
            console.error('Не удалось скачать логотип:', e.message);
        }

        try {
            // Основное изображение (600x900) делаем из квадратной иконки игры.
            await createPortraitCapsule(tempPngPath, path.join(gameDir, 'capsule.png'));
            console.log(`Основное изображение (600x900) сохранено в: ${path.join(gameDir, 'capsule.png')}`);
        } catch (e) {
            console.error('Не удалось создать основное изображение:', e.message);
        }

        fs.unlinkSync(tempPngPath);

        const appIdUnsigned = generateAppIdUnsigned(exe, gameName);
        const appIdSigned = toSigned32(appIdUnsigned);
        console.log(`Назначенный appid: ${appIdUnsigned}`);

        const newShortcut = {
            appid: appIdSigned,
            AppName: gameName,
            Exe: exe,
            StartDir: `"${gameDir}"`,
            icon: iconPath,
            LaunchOptions: launchOptions,
            IsHidden: false,
            AllowDesktopConfig: true,
            AllowOverlay: true,
            OpenVR: false,
            Devkit: false,
            DevkitGameID: "",
            tags: {}
        };

        copyArtworkToGrid(appIdUnsigned, gameDir, gridDir);

        shortcuts.shortcuts.push(newShortcut);
        const newBuffer = shortcut.writeBuffer(shortcuts);
        fs.writeFileSync(shortcutsPath, newBuffer);
        console.log('Shortcut added to Steam!');
        console.log('Please restart Steam to see the new game and its artwork.');

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('API Response:', error.response.data);
        }
    }
}

async function run(gameUrl) {
    if (!gameUrl) {
        console.error('Please specify a Roblox game URL.');
        process.exit(1);
    }
    await addToSteam(gameUrl);
}

module.exports = { run };

if (require.main === module) {
    const url = process.argv[2];
    run(url);
}
