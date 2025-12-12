/*
 * Основной JavaScript-модуль для конвертера треков Any2Nmap.
 * Для работы этого скрипта требуется API браузерных расширений (chrome.*)
 * и подключенная библиотека JSZip.
 */

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Элементы ---
    const loginBtn = document.getElementById('login-yandex');
    const authBlock = document.getElementById('auth-block');
    const appDiv = document.getElementById('app');
    const statusDiv = document.getElementById('status');
    const fileInput = document.getElementById('file-input');
    const folderNameInput = document.getElementById('folder-name');
    const convertBtn = document.getElementById('convert-upload');

    // --- Локализация для динамических атрибутов ---
    folderNameInput.placeholder = chrome.i18n.getMessage('folderNamePlaceholder');


    let yandexToken = null;

    // =================================================================
    // --- ЛОГИКА АВТОРИЗАЦИИ (Chrome Extension Identity API) ---
    // =================================================================

    function getAuthToken(interactive) {
        if (typeof chrome === 'undefined' || !chrome.identity) {
            statusDiv.textContent = 'Error: Extension API is not available.';
            return;
        }

        chrome.identity.getAuthToken({ interactive: interactive }, (token) => {
            if (chrome.runtime.lastError || !token) {
                const errorMessage = chrome.i18n.getMessage('statusAuthFailure') + (chrome.runtime.lastError ? ` ${chrome.runtime.lastError.message}` : '');
                statusDiv.textContent = errorMessage;
                authBlock.style.display = 'block';
                appDiv.style.display = 'none';
                return;
            }
            yandexToken = token;
            onLoginSuccess();
        });
    }

    function onLoginSuccess() {
        authBlock.style.display = 'none';
        appDiv.style.display = 'block';
        statusDiv.textContent = chrome.i18n.getMessage('statusAuthSuccess');
    }

    loginBtn.addEventListener('click', () => {
        getAuthToken(true);
    });

    getAuthToken(false);


    // =================================================================
    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    // =================================================================

    function uuidv4() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function middle_point(path) {
        if (path.length > 2) return path[Math.floor((path.length - 1) / 2)];
        if (path.length === 2) return [(path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2];
        return path[0];
    }

    // =================================================================
    // --- ЛОГИКА ПАРСИНГА ФАЙЛОВ ---
    // =================================================================

    function gpx_parse(gpxText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(gpxText, "text/xml");
        const points = {}, paths = {}, waypoints = [];
        xmlDoc.querySelectorAll('trk').forEach(track => {
            const coords = Array.from(track.querySelectorAll('trkpt')).map(pt => [parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat'))]);
            if (coords.length > 0) {
                paths[uuidv4()] = coords;
                const name = track.querySelector('name')?.textContent;
                if (name) {
                    const mid_pt = middle_point(coords);
                    waypoints.push({ lon: mid_pt[0], lat: mid_pt[1], name });
                }
            }
        });
        xmlDoc.querySelectorAll('rte').forEach(route => {
             const coords = Array.from(route.querySelectorAll('rtept')).map(pt => [parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat'))]);
             if (coords.length > 0) {
                paths[uuidv4()] = coords;
                const name = route.querySelector('name')?.textContent;
                if (name) {
                    const mid_pt = middle_point(coords);
                    waypoints.push({ lon: mid_pt[0], lat: mid_pt[1], name });
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
        const points = {}, paths = {};
        xmlDoc.querySelectorAll('Placemark').forEach(pm => {
            const name = pm.querySelector('name')?.textContent.trim();
            const description = (pm.querySelector('description')?.textContent || '').trim().replace(/<.*?>/g, '');
            const line = pm.querySelector('LineString > coordinates');
            if (line) {
                const coords = line.textContent.trim().split(/\s+/).map(cs => cs.split(',').map(Number));
                paths[uuidv4()] = coords;
                if (name) points[uuidv4()] = {'coords': middle_point(coords), 'desc': name};
            }
            const point = pm.querySelector('Point > coordinates');
            if (point) {
                const coords = point.textContent.trim().split(',').map(Number);
                points[uuidv4()] = { coords, desc: [name, description].filter(Boolean).join('\n') };
            }
        });
        return { points, paths };
    }

    async function kmz_parse(file) {
        const zip = await new JSZip().loadAsync(file);
        const kmlFile = zip.file(/(\.kml)$/i)[0];
        if (!kmlFile) throw new Error(chrome.i18n.getMessage('errorNoKmlInKmz'));
        return kml_parse(await kmlFile.async('string'));
    }

    function csv_parse(csvText) {
        const points = {};
        const lines = csvText.split(/\r?\n/).filter(line => line.trim());
        const headerLine = lines[0].toLowerCase();
        const hasHeader = headerLine.includes('lat') || headerLine.includes('lon');
        const data = hasHeader ? lines.slice(1) : lines;
        let latIdx = -1, lonIdx = -1;
        if (hasHeader) {
            const headers = lines[0].split(',').map(h => h.toLowerCase().trim());
            latIdx = headers.findIndex(h => h.includes('lat'));
            lonIdx = headers.findIndex(h => h.includes('lon'));
        } else {
            const firstRow = data[0].split(',');
            for (let i = 0; i < firstRow.length; i++) {
                if (!isNaN(parseFloat(firstRow[i]))) {
                    if (latIdx === -1) latIdx = i;
                    else if (lonIdx === -1) { lonIdx = i; break; }
                }
            }
        }
        if (latIdx === -1 || lonIdx === -1) throw new Error(chrome.i18n.getMessage('errorCsvColumns'));
        data.forEach(line => {
            const values = line.split(',');
            const lat = parseFloat(values[latIdx]);
            const lon = parseFloat(values[lonIdx]);
            if (!isNaN(lat) && !isNaN(lon)) {
                const desc = values.filter((_, i) => i !== latIdx && i !== lonIdx).join(', ');
                points[uuidv4()] = { coords: [lon, lat], desc };
            }
        });
        return { points, paths: {} };
    }

    // =================================================================
    // --- ИНТЕГРАЦИЯ С ЯНДЕКС ДИСКОМ ---
    // =================================================================

    async function uploadToYandexDisk(folderName, data) {
        const path = `/Приложения/Блокнот картографа Народной карты/${folderName}`;
        const apiUrl = 'https://cloud-api.yandex.net/v1/disk/resources';
        const headers = { 'Authorization': `OAuth ${yandexToken}` };

        statusDiv.textContent = chrome.i18n.getMessage('statusCreatingFolder');
        await fetch(`${apiUrl}?path=${encodeURIComponent(path)}`, { method: 'PUT', headers });

        statusDiv.textContent = chrome.i18n.getMessage('statusGettingUrl');
        const uploadUrlRes = await fetch(`${apiUrl}/upload?path=${encodeURIComponent(path + '/index.json')}&overwrite=true`, { headers });
        if (!uploadUrlRes.ok) throw new Error(chrome.i18n.getMessage('errorGetUploadUrl'));
        const { href } = await uploadUrlRes.json();

        statusDiv.textContent = chrome.i18n.getMessage('statusUploading');
        const uploadRes = await fetch(href, {
            method: 'PUT',
            body: new Blob([JSON.stringify(data)], {type: 'application/json'})
        });
        if (!uploadRes.ok) throw new Error(chrome.i18n.getMessage('errorFileUpload'));

        statusDiv.textContent = chrome.i18n.getMessage('statusSuccess');
    }

    // =================================================================
    // --- ГЛАВНАЯ ЛОГИКА ПРИЛОЖЕНИЯ ---
    // =================================================================

    convertBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        const folderName = folderNameInput.value.trim();

        if (!file || !folderName) {
            alert(chrome.i18n.getMessage('alertMissingInput'));
            return;
        }
        convertBtn.disabled = true;
        statusDiv.textContent = chrome.i18n.getMessage('statusProcessing');

        try {
            const ext = file.name.split('.').pop().toLowerCase();
            let resultData;
            if (ext === 'kmz') {
                resultData = await kmz_parse(await file.arrayBuffer());
            } else {
                 const text = await file.text();
                 if (ext === 'gpx') resultData = gpx_parse(text);
                 else if (ext === 'kml') resultData = kml_parse(text);
                 else if (ext === 'csv') resultData = csv_parse(text);
                 else throw new Error(chrome.i18n.getMessage('errorUnsupportedFile'));
            }

            await uploadToYandexDisk(folderName, resultData);
        } catch (error) {
            statusDiv.textContent = `${chrome.i18n.getMessage('errorGeneric')} ${error.message}`;
            console.error(error);
        } finally {
            convertBtn.disabled = false;
        }
    });
});
