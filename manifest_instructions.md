# Инструкции по модификации `manifest.json`

Чтобы интегрировать конвертер в ваше существующее расширение, вам нужно внести следующие изменения в ваш файл `manifest.json`.

1.  **Добавьте разрешение `identity`**:
    Это разрешение необходимо для использования API аутентификации браузера (`chrome.identity`).

    ```json
    "permissions": [
        "identity",
        // ... другие ваши разрешения
    ],
    ```

2.  **Добавьте блок `oauth2`**:
    Этот блок регистрирует ваше приложение в браузере как OAuth 2.0 клиент. Браузер будет использовать эти данные для корректного формирования запросов к Яндексу. **Вставьте ваш `client_id`**, который вы мне предоставили.

    ```json
    "oauth2": {
        "client_id": "20a5e57c3a524f1984b3be55baa8b358",
        "scopes": [
            "cloud_api:disk.app_folder"
        ]
    }
    ```

3. **Добавьте `default_locale`**:
   Это поле необходимо для работы локализации (`_locales`).

   ```json
   "default_locale": "en",
   ```

**Полный пример `manifest.json` может выглядеть так:**

```json
{
    "manifest_version": 3,
    "name": "Ваше Расширение",
    "version": "1.0",
    "description": "Описание вашего расширения.",
    "default_locale": "en",

    "permissions": [
        "identity",
        "storage"
    ],

    "oauth2": {
        "client_id": "20a5e57c3a524f1984b3be55baa8b358",
        "scopes": [
            "cloud_api:disk.app_folder"
        ]
    },

    "action": {
        "default_popup": "popup.html"
    }
}
```

После внесения этих изменений и добавления файлов `any2nmap_ui.html` и `any2nmap.js` в ваш проект, конвертер должен заработать.
