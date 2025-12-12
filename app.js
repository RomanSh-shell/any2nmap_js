const REDIRECT_URI = window.location.origin + window.location.pathname;

// --- DOM Элементы ---
const authBlock = document.getElementById('auth-block');
const clientIdInput = document.getElementById('client-id');
const loginBtn = document.getElementById('login-yandex');
const appDiv = document.getElementById('app');
const statusDiv = document.getElementById('status');
const fileInput = document.getElementById('file-input');
const folderNameInput = document.getElementById('folder-name');
const convertBtn = document.getElementById('convert-upload');

let yandexToken = null;
let clientId = null;

// =================================================================
// --- ЛОГИКА АВТОРИЗАЦИИ (OAuth) ---
// =================================================================

function getTokenFromUrl() {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');

    if (token) {
        history.pushState("", document.title, window.location.pathname + window.location.search);
        // Сохраняем токен и Client ID, который использовался для его получения
        localStorage.setItem('yandexToken', token);
        const storedClientId = localStorage.getItem('clientIdForToken');
        if(storedClientId) {
            localStorage.setItem('clientId', storedClientId);
        }
        return token;
    }
    return null;
}

function onLoginSuccess(token) {
    yandexToken = token;
    authBlock.style.display = 'none';
    appDiv.style.display = 'block';
    statusDiv.textContent = 'Вы успешно авторизованы! Теперь выберите файл.';
    console.log('Получен токен:', yandexToken);
}

loginBtn.addEventListener('click', () => {
    clientId = clientIdInput.value.trim();
    if (!clientId) {
        alert('Пожалуйста, введите ваш Client ID.');
        return;
    }
    // Сохраняем Client ID, чтобы использовать его после редиректа
    localStorage.setItem('clientIdForToken', clientId);
    const authUrl = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    window.location.href = authUrl;
});

window.addEventListener('load', () => {
    // Пытаемся получить токен из URL (после редиректа)
    const tokenFromUrl = getTokenFromUrl();
    if (tokenFromUrl) {
        onLoginSuccess(tokenFromUrl);
        return;
    }

    // Если токена в URL нет, ищем в localStorage
    const tokenFromStorage = localStorage.getItem('yandexToken');
    const clientIdFromStorage = localStorage.getItem('clientId');
    if (tokenFromStorage && clientIdFromStorage) {
        yandexToken = tokenFromStorage;
        clientId = clientIdFromStorage;
        clientIdInput.value = clientId; // Показываем ID пользователю
        onLoginSuccess(yandexToken);
    }
});


// =================================================================
// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
// =================================================================

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function middle_point(path) {
    if (path.length > 2) {
        return path[Math.floor((path.length - 1) / 2)];
    } else if (path.length === 2) {
        const lon = (path[0][0] + path[1][0]) / 2;
        const lat = (path[0][1] + path[1][1]) / 2;
        return [lon, lat];
    } else {
        return path[0];
    }
}

// =================================================================
// --- ЛОГИКА ПАРСИНГА ФАЙЛОВ ---
// =================================================================

function gpx_parse(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, "text/xml");
    const points = {};
    const paths = {};
    const waypoints = [];
    xmlDoc.querySelectorAll('trk').forEach(track => {
        const trk_coord = [];
        track.querySelectorAll('trkpt').forEach(pt => {
            trk_coord.push([parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat'))]);
        });
        if (trk_coord.length > 0) {
            paths[uuidv4()] = trk_coord;
            const trackName = track.querySelector('name')?.textContent;
            if (trackName) {
                const mid_pt = middle_point(trk_coord);
                waypoints.push({ lon: mid_pt[0], lat: mid_pt[1], name: trackName });
            }
        }
    });
    xmlDoc.querySelectorAll('rte').forEach(route => {
        const path_coord = [];
        route.querySelectorAll('rtept').forEach(pt => {
            path_coord.push([parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat'))]);
        });
        if (path_coord.length > 0) {
            paths[uuidv4()] = path_coord;
            const routeName = route.querySelector('name')?.textContent;
            if (routeName) {
                const mid_pt = middle_point(path_coord);
                waypoints.push({ lon: mid_pt[0], lat: mid_pt[1], name: routeName });
            }
        }
    });
    xmlDoc.querySelectorAll('wpt').forEach(wpt => {
        waypoints.push({
            lon: parseFloat(wpt.getAttribute('lon')),
            lat: parseFloat(wpt.getAttribute('lat')),
            name: wpt.querySelector('name')?.textContent,
            desc: wpt.querySelector('desc')?.textContent,
            cmt: wpt.querySelector('cmt')?.textContent,
        });
    });
    waypoints.forEach(wp => {
        points[uuidv4()] = {
            coords: [wp.lon, wp.lat],
            desc: [wp.name, wp.cmt, wp.desc].filter(Boolean).join('\n')
        };
    });
    return { points, paths };
}

function kml_parse(kmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(kmlText, "text/xml");
    const points = {};
    const paths = {};
    xmlDoc.querySelectorAll('Placemark').forEach(pm => {
        const name = pm.querySelector('name')?.textContent.trim();
        const description = pm.querySelector('description')?.textContent.trim().replace(/<.*?>/g, '') || '';
        const lineString = pm.querySelector('LineString > coordinates');
        if (lineString) {
            const path_point = lineString.textContent.trim().split(/\s+/).map(coordStr => {
                const [lon, lat] = coordStr.split(',').map(Number);
                return [lon, lat];
            });
            paths[uuidv4()] = path_point;
            if (name) {
                 points[uuidv4()] = {'coords': middle_point(path_point), 'desc': name};
            }
        }
        const pointNode = pm.querySelector('Point > coordinates');
        if (pointNode) {
             const [lon, lat] = pointNode.textContent.trim().split(',').map(Number);
             points[uuidv4()] = { coords: [lon, lat], desc: [name, description].filter(Boolean).join('\n') };
        }
    });
    return { points, paths };
}

async function kmz_parse(file) {
    const jszip = new JSZip();
    const zip = await jszip.loadAsync(file);
    const kmlFile = zip.file(/(\.kml)$/i)[0];
    if (!kmlFile) throw new Error('В KMZ-архиве не найден KML-файл.');
    const kmlText = await kmlFile.async('string');
    return kml_parse(kmlText);
}

function csv_parse(csvText) {
    const points = {};
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    const header = lines[0].toLowerCase().includes('lat') || lines[0].toLowerCase().includes('lon');
    const dataLines = header ? lines.slice(1) : lines;
    let latIndex = -1, lonIndex = -1;
    if (header) {
        const headers = lines[0].split(',').map(h => h.toLowerCase().trim());
        latIndex = headers.findIndex(h => h.includes('lat'));
        lonIndex = headers.findIndex(h => h.includes('lon'));
    } else {
        const firstRow = dataLines[0].split(',');
        for (let i = 0; i < firstRow.length; i++) {
            if (!isNaN(parseFloat(firstRow[i]))) {
                if (latIndex === -1) latIndex = i;
                else if (lonIndex === -1) { lonIndex = i; break; }
            }
        }
    }
    if (latIndex === -1 || lonIndex === -1) throw new Error('Не удалось определить столбцы с широтой и долготой в CSV.');
    dataLines.forEach(line => {
        const values = line.split(',');
        const lat = parseFloat(values[latIndex]);
        const lon = parseFloat(values[lonIndex]);
        if (!isNaN(lat) && !isNaN(lon)) {
            const desc = values.map((val, i) => (i !== latIndex && i !== lonIndex) ? val : null).filter(Boolean).join(', ');
            points[uuidv4()] = { coords: [lon, lat], desc: desc };
        }
    });
    return { points, paths: {} };
}

// =================================================================
// --- ИНТЕГРАЦИЯ С ЯНДЕКС ДИСКОМ ---
// =================================================================

async function uploadToYandexDisk(folderName, data) {
    const basePath = '/Приложения/Блокнот картографа Народной карты/';
    const fullFolderPath = `${basePath}${folderName}`;
    const filePath = `${fullFolderPath}/index.json`;
    const apiUrl = 'https://cloud-api.yandex.net/v1/disk/resources';

    const headers = { 'Authorization': `OAuth ${yandexToken}` };

    // 1. Создаем папку
    statusDiv.textContent = `Создаю папку на Яндекс Диске: ${fullFolderPath}`;
    let response = await fetch(`${apiUrl}?path=${encodeURIComponent(fullFolderPath)}`, {
        method: 'PUT',
        headers: headers
    });

    if (!response.ok && response.status !== 409) { // 409 - папка уже существует, это нормально
        throw new Error(`Ошибка при создании папки: ${response.statusText}`);
    }

    // 2. Получаем ссылку для загрузки файла
    statusDiv.textContent = 'Получаю ссылку для загрузки...';
    response = await fetch(`${apiUrl}/upload?path=${encodeURIComponent(filePath)}&overwrite=true`, {
        headers: headers
    });

    if (!response.ok) {
        throw new Error(`Ошибка при получении ссылки для загрузки: ${response.statusText}`);
    }

    const uploadData = await response.json();

    // 3. Загружаем сам файл
    statusDiv.textContent = 'Загружаю файл index.json...';
    const jsonData = JSON.stringify(data, null, 2);
    response = await fetch(uploadData.href, {
        method: 'PUT',
        body: new Blob([jsonData], {type: 'application/json'})
    });

    if (!response.ok) {
        throw new Error(`Ошибка при загрузке файла: ${response.statusText}`);
    }

    statusDiv.textContent = 'Успешно! Файл index.json загружен на ваш Яндекс Диск.';
}

// =================================================================
// --- ГЛАВНАЯ ЛОГИКА ПРИЛОЖЕНИЯ ---
// =================================================================

convertBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    const folderName = folderNameInput.value.trim();

    if (!file || !folderName || !yandexToken) {
        alert('Пожалуйста, выберите файл, введите имя папки и убедитесь, что вы авторизованы.');
        return;
    }

    convertBtn.disabled = true;
    statusDiv.textContent = 'Начинаю обработку файла...';

    try {
        const extension = file.name.split('.').pop().toLowerCase();
        let resultData;

        switch (extension) {
            case 'gpx':
            case 'kml':
            case 'csv':
                resultData = window[`${extension}_parse`](await file.text());
                break;
            case 'kmz':
                resultData = await kmz_parse(await file.arrayBuffer());
                break;
            default:
                throw new Error(`Неподдерживаемый тип файла: .${extension}`);
        }

        statusDiv.textContent = 'Файл успешно сконвертирован!';
        console.log('Результат конвертации:', resultData);

        await uploadToYandexDisk(folderName, resultData);

    } catch (error) {
        statusDiv.textContent = `Ошибка: ${error.message}`;
        console.error(error);
    } finally {
        convertBtn.disabled = false;
    }
});
