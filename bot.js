async function BOT_TOKEN(env) {
    return env.TELEGRAM_BOT_TOKEN.get();
}
const CACHE = env => env.UTILITOOL_BOT_CACHE;

const SESSION_TTL = 15 * 60;

async function telegram(env, method, body = null) {
    const token =
        await BOT_TOKEN(env);

    if (
        typeof token !== "string" ||
        !token
    ) {
        throw new Error(
            `${method}: Telegram bot token is missing.`
        );
    }

    const url =
        `https://api.telegram.org/bot${token}/${method}`;

    const options = {
        method: body ? "POST" : "GET",
        headers: {}
    };

    if (body) {
        options.headers["Content-Type"] =
            "application/json";

        options.body =
            JSON.stringify(body);
    }

    const response =
        await fetch(url, options);

    const text =
        await response.text();

    let data;

    try {
        data =
            JSON.parse(text);
    } catch {
        throw new Error(
            `${method}: HTTP ${response.status}; non-JSON response: ${text.slice(0, 300)}`
        );
    }

    if (!data.ok) {
        throw new Error(
            `${method}: HTTP ${response.status}; Telegram ${data.error_code}: ${data.description || "Unknown error"}`
        );
    }

    return data.result;
}

async function sendMessage(env, chatId, text, extra = {}) {
    return telegram(env, "sendMessage", {
        chat_id: chatId,
        text,
        ...extra
    });
}

async function editMessage(
    env,
    chatId,
    messageId,
    menu
) {
    return telegram(
        env,
        "editMessageText",
        {
            chat_id:
                chatId,

            message_id:
                messageId,

            text:
                menu.text,

            reply_markup:
                menu.reply_markup
        }
    );
}

async function deleteMessage(
    env,
    chatId,
    messageId
) {
    return telegram(
        env,
        "deleteMessage",
        {
            chat_id:
                chatId,

            message_id:
                messageId
        }
    );
}

function isBotMentioned(message) {
    const text =
        message.text ||
        message.caption ||
        "";

    const entities =
        message.entities ||
        message.caption_entities ||
        [];

    const entityMention =
        entities.some(
            entity => {
                if (
                    entity.type !==
                    "mention"
                ) {
                    return false;
                }

                const mention =
                    text.slice(
                        entity.offset,
                        entity.offset +
                            entity.length
                    );

                return (
                    mention.toLowerCase() ===
                    "@utilitool_bot"
                );
            }
        );

    if (entityMention) {
        return true;
    }

    /*
     * Fallback for cases where Telegram does not
     * provide the mention entity.
     */
    return /@utilitool_bot\b/i.test(
        text
    );
}

async function createBaseMenu(
    env,
    chatId,
    username
) {
    const menu =
        mainMenu(
            username || "there"
        );

    const message =
        await sendMessage(
            env,
            chatId,
            menu.text,
            {
                reply_markup:
                    menu.reply_markup
            }
        );

    await saveMenuState(
        env,
        chatId,
        message.message_id,
        username
    );

    return message;
}

async function showBaseMenu(
    env,
    chatId,
    username
) {
    const existing =
        await getMenuState(
            env,
            chatId
        );

    if (existing?.messageId) {
        try {
            await editMessage(
                env,
                chatId,
                existing.messageId,
                mainMenu(
                    username || "there"
                )
            );

            await saveMenuState(
                env,
                chatId,
                existing.messageId,
                username
            );

            return existing.messageId;
        } catch {
            await deleteMenuState(
                env,
                chatId
            );
        }
    }

    const message =
        await createBaseMenu(
            env,
            chatId,
            username
        );

    return message.message_id;
}

async function editCurrentMenu(
    env,
    chatId,
    menu
) {
    const state =
        await getMenuState(
            env,
            chatId
        );

    if (!state?.messageId) {
        return null;
    }

    try {
        await editMessage(
            env,
            chatId,
            state.messageId,
            menu
        );

        return state.messageId;
    } catch (error) {
        console.error(
            "Unable to edit current menu:",
            error
        );

        await deleteMenuState(
            env,
            chatId
        );

        return null;
    }
}

async function leaveChat(env, chatId) {
    try {
        await telegram(env, "leaveChat", {
            chat_id: chatId
        });
    } catch {}
}

async function answerCallback(env, callbackId) {
    try {
        await telegram(env, "answerCallbackQuery", {
            callback_query_id: callbackId
        });
    } catch {}
}

async function getFile(env, fileId) {
    return telegram(env, "getFile", {
        file_id: fileId
    });
}

async function downloadTelegramFile(env, fileId) {
    const file =
        await getFile(env, fileId);

    if (!file.file_path) {
        throw new Error("Telegram did not return a file path.");
    }

    const token =
        await BOT_TOKEN(env);
    
    const response =
        await fetch(
            `https://api.telegram.org/file/bot${token}/${file.file_path}`
        );

    if (!response.ok) {
        throw new Error(
            `Telegram file download failed: ${response.status}`
        );
    }

    return {
        response,
        file
    };
}

async function setChatPhoto(env, chatId, blob) {
    const form =
        new FormData();

    form.append(
        "chat_id",
        String(chatId)
    );

    form.append(
        "photo",
        blob,
        "profile.jpg"
    );

    const token =
        await BOT_TOKEN(env);
    
    const response =
        await fetch(
            `https://api.telegram.org/bot${token}/setChatPhoto`,
            {
                method: "POST",
                body: form
            }
        );

    const data =
        await response.json();

    if (!data.ok) {
        throw new Error(
            data.description || "setChatPhoto failed."
        );
    }

    return data.result;
}

function mainMenu(username) {
    return {
        text:
            `@${username}, what would you like me to do?`,
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text:
                            "Change Profile Photo",
                        callback_data:
                            "photo"
                    }
                ],
                [
                    {
                        text:
                            "Bye",
                        callback_data:
                            "bye"
                    }
                ]
            ]
        }
    };
}

function photoMenu() {
    return {
        text:
            "Reply to the image or image document you want to use with @utilitool_bot.",
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text:
                            "Cancel",
                        callback_data:
                            "cancel_photo"
                    }
                ]
            ]
        }
    };
}

function cropMenu(sessionId) {
    const cropUrl =
        `https://t.me/utilitool_bot/set_photo?startapp=${encodeURIComponent(sessionId)}`;

    return {
        text:
            "Position the square over the part of the image you want to use, then press Apply.",
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text:
                            "Open Photo Cropper",
                        url:
                            cropUrl
                    }
                ],
                [
                    {
                        text:
                            "Cancel",
                        callback_data:
                            `cancel_photo:${sessionId}`
                    }
                ]
            ]
        }
    };
}

function randomId() {
    return crypto.randomUUID();
}

async function saveSession(env, id, data) {
    await CACHE(env).put(
        `crop:${id}`,
        JSON.stringify(data),
        {
            expirationTtl: SESSION_TTL
        }
    );
}

async function getSession(env, id) {
    const value =
        await CACHE(env).get(`crop:${id}`);

    if (!value) {
        return null;
    }

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

async function deleteSession(
    env,
    sessionId
) {
    await CACHE(env).delete(
        `crop:${sessionId}`
    );
}

function menuStateKey(chatId) {
    return `menu:${String(chatId)}`;
}

async function getMenuState(env, chatId) {
    const value =
        await CACHE(env).get(
            menuStateKey(chatId),
            "json"
        );

    return value || null;
}

async function saveMenuState(
    env,
    chatId,
    messageId,
    username
) {
    await CACHE(env).put(
        menuStateKey(chatId),
        JSON.stringify({
            chatId,
            messageId,
            username:
                username || null
        })
    );
}

async function deleteMenuState(
    env,
    chatId
) {
    await CACHE(env).delete(
        menuStateKey(chatId)
    );
}

function getReplyImage(message) {
    const reply =
        message.reply_to_message;

    if (!reply) {
        return null;
    }

    if (
        Array.isArray(reply.photo) &&
        reply.photo.length
    ) {
        return reply.photo
            .slice()
            .sort(
                (a, b) =>
                    (b.file_size || 0) -
                    (a.file_size || 0)
            )[0];
    }

    const document =
        reply.document;

    if (!document) {
        return null;
    }

    const mimeType =
        String(
            document.mime_type || ""
        ).toLowerCase();

    const fileName =
        String(
            document.file_name || ""
        ).toLowerCase();

    const imageExtension =
        /\.(?:jpg|jpeg|png|webp|gif|bmp|tiff|tif|avif)$/i;

    if (
        mimeType.startsWith("image/") ||
        imageExtension.test(fileName)
    ) {
        return {
            file_id:
                document.file_id,

            file_size:
                document.file_size || 0
        };
    }

    return null;
}

function getUserFromMessage(message) {
    return message.from || null;
}

async function validateTelegramInitData(
    env,
    initData
) {
    if (!initData) {
        throw new Error(
            "Missing Telegram initialization data."
        );
    }

    const params =
        new URLSearchParams(
            initData
        );

    const receivedHash =
        params.get("hash");

    if (!receivedHash) {
        throw new Error(
            "Missing Telegram initialization hash."
        );
    }

    params.delete("hash");

    params.sort();

    const dataCheckString =
        Array.from(
            params.entries()
        )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join("\n");

    const encoder =
        new TextEncoder();

    const token =
        await BOT_TOKEN(env);

    if (
        typeof token !== "string" ||
        !token
    ) {
        throw new Error(
            "Telegram bot token is missing."
        );
    }

    /*
     * Telegram Web App validation:
     *
     * secretKey =
     *     HMAC-SHA256(
     *         key: "WebAppData",
     *         message: bot token
     *     )
     */

    const secretKeyMaterial =
        await crypto.subtle.importKey(
            "raw",
            encoder.encode(
                "WebAppData"
            ),
            {
                name: "HMAC",
                hash: "SHA-256"
            },
            false,
            ["sign"]
        );

    const secretKey =
        await crypto.subtle.sign(
            "HMAC",
            secretKeyMaterial,
            encoder.encode(
                token
            )
        );

    /*
     * calculatedHash =
     *     HMAC-SHA256(
     *         key: secretKey,
     *         message: dataCheckString
     *     )
     */

    const validationKey =
        await crypto.subtle.importKey(
            "raw",
            secretKey,
            {
                name: "HMAC",
                hash: "SHA-256"
            },
            false,
            ["sign"]
        );

    const calculatedHashBuffer =
        await crypto.subtle.sign(
            "HMAC",
            validationKey,
            encoder.encode(
                dataCheckString
            )
        );

    const calculatedHash =
        Array.from(
            new Uint8Array(
                calculatedHashBuffer
            )
        )
            .map(
                byte =>
                    byte
                        .toString(16)
                        .padStart(
                            2,
                            "0"
                        )
            )
            .join("");

    if (
        calculatedHash.length !==
        receivedHash.length
    ) {
        throw new Error(
            "Invalid Telegram initialization data."
        );
    }

    let difference = 0;

    for (
        let i = 0;
        i < calculatedHash.length;
        i++
    ) {
        difference |=
            calculatedHash.charCodeAt(i) ^
            receivedHash.charCodeAt(i);
    }

    if (difference !== 0) {
        throw new Error(
            "Invalid Telegram initialization data."
        );
    }

    const authDate =
        Number(
            params.get(
                "auth_date"
            )
        );

    if (
        !Number.isFinite(
            authDate
        )
    ) {
        throw new Error(
            "Telegram initialization data has no valid auth date."
        );
    }

    if (
        Math.abs(
            Date.now() / 1000 -
            authDate
        ) > 3600
    ) {
        throw new Error(
            "Telegram initialization data has expired."
        );
    }

    let user = null;

    const userData =
        params.get("user");

    if (userData) {
        try {
            user =
                JSON.parse(
                    userData
                );
        } catch {
            throw new Error(
                "Invalid Telegram user data."
            );
        }
    }

    return {
        user,
        params
    };
}

async function authorizeSession(
    env,
    request,
    session
) {
    const initData =
        getInitData(request);

    const auth =
        await validateTelegramInitData(
            env,
            initData
        );

    if (!auth.user?.id) {
        throw new Error(
            "Telegram user information is missing."
        );
    }

    if (
        session.userId &&
        Number(session.userId) !==
            Number(auth.user.id)
    ) {
        throw new Error(
            "This crop session belongs to another Telegram user."
        );
    }

    return auth;
}

function getInitData(request) {
    return (
        request.headers.get(
            "X-Telegram-Init-Data"
        ) ||
        request.headers
            .get("Authorization")
            ?.replace(
                /^tma\s+/i,
                ""
            ) ||
        ""
    );
}

async function handlePhotoReply(
    env,
    message
) {
    if (!message.reply_to_message) {
        return;
    }

    if (!isBotMentioned(message)) {
        return;
    }

    const menuState =
        await getMenuState(
            env,
            message.chat.id
        );

    if (!menuState) {
        return;
    }

    if (
        menuState.mode !==
        "waiting_for_photo"
    ) {
        return;
    }

    if (
        !menuState.requesterId
    ) {
        return;
    }

    if (
        Number(message.from?.id) !==
        Number(menuState.requesterId)
    ) {
        return;
    }

    const photo =
        getReplyImage(
            message
        );

    if (!photo) {
        await sendMessage(
            env,
            message.chat.id,
            "The message you replied to doesn't contain an image."
        );

        return;
    }

    if (
        photo.file_size &&
        photo.file_size >
            20 * 1024 * 1024
    ) {
        await sendMessage(
            env,
            message.chat.id,
            "That image is too large. Telegram bots can only download files up to 20 MB."
        );

        return;
    }

    const sessionId =
        randomId();

    await saveSession(
        env,
        sessionId,
        {
            chatId:
                message.chat.id,

            fileId:
                photo.file_id,

            userId:
                message.from.id,

            username:
                message.from?.username ||
                null,

            firstName:
                message.from?.first_name ||
                null,

            menuMessageId:
                menuState.messageId
        }
    );

    /*
     * The file_id is now stored in KV.
     * The user's @bot message is no longer needed.
     */
    try {
        await deleteMessage(
            env,
            message.chat.id,
            message.message_id
        );
    } catch (error) {
        console.error(
            "Unable to delete photo reply:",
            error
        );
    }

    const menu =
        cropMenu(
            sessionId
        );

    try {
        await editMessage(
            env,
            message.chat.id,
            menuState.messageId,
            menu
        );
    } catch (error) {
        console.error(
            "Unable to edit crop menu:",
            error
        );

        return;
    }

    await CACHE(env).put(
        menuStateKey(
            message.chat.id
        ),
        JSON.stringify({
            ...menuState,
            mode:
                "crop",
            sessionId
        })
    );
}

async function handleCropImage(
    env,
    request,
    url
) {
    const sessionId =
        url.searchParams.get(
            "session"
        );

    if (!sessionId) {
        return new Response(
            "Missing session.",
            {
                status: 400
            }
        );
    }

    const session =
        await getSession(
            env,
            sessionId
        );

    if (!session) {
        return new Response(
            "Crop session expired.",
            {
                status: 410
            }
        );
    }

    try {
        await authorizeSession(
            env,
            request,
            session
        );
    } catch (error) {
        return new Response(
            error.message,
            {
                status: 403
            }
        );
    }

    try {
        const {
            response,
            file
        } =
            await downloadTelegramFile(
                env,
                session.fileId
            );

        const headers =
            new Headers();

        headers.set(
            "Content-Type",
            response.headers.get(
                "Content-Type"
            ) ||
                "image/jpeg"
        );

        headers.set(
            "Cache-Control",
            "private, no-store"
        );

        if (file.file_size) {
            headers.set(
                "Content-Length",
                String(
                    file.file_size
                )
            );
        }

        return new Response(
            response.body,
            {
                headers
            }
        );
    } catch (error) {
        console.error(
            "Crop image error:",
            error
        );

        return new Response(
            "Unable to retrieve the Telegram image.",
            {
                status: 502
            }
        );
    }
}

async function handleCropSubmit(
    env,
    request
) {
    let form;

    try {
        form =
            await request.formData();
    } catch {
        return new Response(
            "Invalid form data.",
            { status: 400 }
        );
    }

    const sessionId =
        String(
            form.get("session") || ""
        );

    const initData =
        String(
            form.get("initData") || ""
        );

    const photo =
        form.get("photo");

    if (!sessionId) {
        return new Response(
            "Missing session.",
            { status: 400 }
        );
    }

    if (
        !photo ||
        typeof photo.arrayBuffer !==
            "function"
    ) {
        return new Response(
            "Missing cropped photo.",
            { status: 400 }
        );
    }

    const session =
        await getSession(
            env,
            sessionId
        );

    if (!session) {
        return new Response(
            "Crop session expired.",
            { status: 404 }
        );
    }

    let auth;

    try {
        auth =
            await validateTelegramInitData(
                env,
                initData
            );
    } catch (error) {
        return new Response(
            error.message,
            { status: 403 }
        );
    }

    if (
        !auth.user?.id
    ) {
        return new Response(
            "Telegram user information is missing.",
            { status: 403 }
        );
    }

    if (
        session.userId &&
        Number(session.userId) !==
            Number(auth.user.id)
    ) {
        return new Response(
            "This crop session belongs to another Telegram user.",
            { status: 403 }
        );
    }

    if (
        photo.size >
        5 * 1024 * 1024
    ) {
        return new Response(
            "Cropped image is too large.",
            { status: 413 }
        );
    }

    const type =
        photo.type || "";

    if (
        type !== "image/jpeg"
    ) {
        return new Response(
            "The cropped image must be JPEG.",
            { status: 400 }
        );
    }

    const blob =
        new Blob(
            [
                await photo.arrayBuffer()
            ],
            {
                type: "image/jpeg"
            }
        );

    try {
        await setChatPhoto(
            env,
            session.chatId,
            blob
        );

        await deleteSession(
            env,
            sessionId
        );

        const username =
            auth.user.username ||
            session.username ||
            null;

        const displayName =
            username
                ? `@${username}`
                : (
                    auth.user.first_name ||
                    session.firstName ||
                    "User"
                );

        await sendMessage(
            env,
            session.chatId,
            `${displayName}, the profile photo has been changed.`
        );
        
        const menu =
            mainMenu(
                username ||
                auth.user.first_name ||
                session.firstName ||
                "User"
            );
        
        if (
            session.menuMessageId
        ) {
            try {
                await editMessage(
                    env,
                    session.chatId,
                    session.menuMessageId,
                    menu
                );
        
                await CACHE(env).put(
                    menuStateKey(
                        session.chatId
                    ),
                    JSON.stringify({
                        chatId:
                            session.chatId,
        
                        messageId:
                            session.menuMessageId,
        
                        username:
                            username ||
                            auth.user.first_name ||
                            session.firstName ||
                            null,
        
                        mode:
                            "base"
                    })
                );
            } catch (error) {
                console.error(
                    "Unable to restore base menu after photo change:",
                    error
                );
            }
        }

        return Response.json({
            success: true
        });
    } catch (error) {
        console.error(
            "setChatPhoto error:",
            error
        );

        return Response.json(
            {
                success: false,
                error:
                    error.message
            },
            { status: 502 }
        );
    }
}

async function handleCropCancel(
    env,
    request,
    sessionId
) {
    if (!sessionId) {
        return new Response(
            "Missing session.",
            {
                status: 400
            }
        );
    }

    const session =
        await getSession(
            env,
            sessionId
        );

    if (!session) {
        return new Response(
            "Crop session expired.",
            {
                status: 410
            }
        );
    }

    try {
        await authorizeSession(
            env,
            request,
            session
        );
    } catch (error) {
        return new Response(
            error.message,
            {
                status: 403
            }
        );
    }

    await deleteSession(
        env,
        sessionId
    );

    if (
        session.menuMessageId
    ) {
        try {
            await editMessage(
                env,
                session.chatId,
                session.menuMessageId,
                mainMenu(
                    session.username ||
                        "there"
                )
            );
        } catch (error) {
            console.error(
                "Unable to restore base menu:",
                error
            );

            /*
             * The menu may have been deleted.
             * Don't create another menu here.
             * The next @bot invocation will create
             * a new active menu if necessary.
             */
        }
    }

    return Response.json({
        success: true
    });
}

async function handleBye(
    env,
    callback
) {
    await answerCallback(
        env,
        callback.id
    );

    const chatId =
        callback.message.chat.id;

    await sendMessage(
        env,
        chatId,
        "Bye!"
    );

    await leaveChat(
        env,
        chatId
    );
}

async function handleCallback(
    env,
    callback
) {
    const data =
        callback.data || "";

    const message =
        callback.message;

    const chatId =
        message?.chat?.id;

    const messageId =
        message?.message_id;

    if (!chatId || !messageId) {
        await telegram(
            env,
            "answerCallbackQuery",
            {
                callback_query_id:
                    callback.id
            }
        );

        return;
    }

    /*
     * This callback message is now the active menu.
     */
    await saveMenuState(
        env,
        chatId,
        messageId,
        callback.from?.username ||
            null
    );

    if (data === "photo") {
    await telegram(
        env,
        "answerCallbackQuery",
        {
            callback_query_id:
                callback.id
        }
    );

    await CACHE(env).put(
        menuStateKey(chatId),
        JSON.stringify({
            chatId,
            messageId,
            username:
                callback.from?.username ||
                null,
            requesterId:
                callback.from.id,
            requesterUsername:
                callback.from?.username ||
                null,
            mode:
                "waiting_for_photo"
        })
    );

    await editMessage(
        env,
        chatId,
        messageId,
        photoMenu()
    );

    return;
}

    if (data === "cancel_photo") {
    await telegram(
        env,
        "answerCallbackQuery",
        {
            callback_query_id:
                callback.id
        }
    );

    await CACHE(env).put(
        menuStateKey(chatId),
        JSON.stringify({
            chatId,
            messageId,
            username:
                callback.from?.username ||
                null,
            mode:
                "base"
        })
    );

    await editMessage(
        env,
        chatId,
        messageId,
        mainMenu(
            callback.from?.username ||
                "there"
        )
    );

    return;
}

    if (
        data.startsWith(
            "cancel_photo:"
        )
    ) {
        const sessionId =
            data.slice(
                "cancel_photo:".length
            );

        await telegram(
            env,
            "answerCallbackQuery",
            {
                callback_query_id:
                    callback.id
            }
        );

        const session =
            await getSession(
                env,
                sessionId
            );

        /*
         * Session may already have expired.
         * Either way, the desired result is
         * the base menu.
         */
        await deleteSession(
            env,
            sessionId
        );

        await editMessage(
            env,
            chatId,
            messageId,
            mainMenu(
                session?.username ||
                    callback.from?.username ||
                    "there"
            )
        );

        return;
    }

    if (data === "bye") {
        await telegram(
            env,
            "answerCallbackQuery",
            {
                callback_query_id:
                    callback.id
            }
        );

        await editMessage(
            env,
            chatId,
            messageId,
            {
                text:
                    "Bye!",
                reply_markup:
                    {
                        inline_keyboard:
                            []
                    }
            }
        );

        await deleteMenuState(
            env,
            chatId
        );

        try {
            await telegram(
                env,
                "leaveChat",
                {
                    chat_id:
                        chatId
                }
            );
        } catch (error) {
            console.error(
                "leaveChat failed:",
                error
            );
        }

        return;
    }

    await telegram(
        env,
        "answerCallbackQuery",
        {
            callback_query_id:
                callback.id
        }
    );
}

async function handleMyChatMember(
    env,
    update
) {
    const change =
        update.my_chat_member;

    if (!change) {
        return;
    }

    const newStatus =
        change.new_chat_member?.status;

    if (
        ![
            "member",
            "administrator"
        ].includes(newStatus)
    ) {
        return;
    }

    const bot =
        change.new_chat_member.user;

    const chat =
        change.chat;

    const username =
        bot.username ||
        "User";

    await createBaseMenu(
        env,
        chat.id,
        username
    );
}

async function handleMessage(
    env,
    message
) {
    if (
        message.reply_to_message &&
        isBotMentioned(message)
    ) {
        await handlePhotoReply(
            env,
            message
        );

        return;
    }

    if (
        message.reply_to_message
    ) {
        return;
    }

    if (!isBotMentioned(message)) {
        return;
    }

    const username =
        message.from?.username ||
        "there";

    await showBaseMenu(
        env,
        message.chat.id,
        username
    );
}

async function handleUpdate(
    env,
    update
) {
    if (
        update.callback_query
    ) {
        await handleCallback(
            env,
            update.callback_query
        );

        return;
    }

    if (
        update.my_chat_member
    ) {
        await handleMyChatMember(
            env,
            update
        );

        return;
    }

    if (
        update.message
    ) {
        await handleMessage(
            env,
            update.message
        );

        return;
    }

    if (
        update.channel_post
    ) {
        await handleMessage(
            env,
            update.channel_post
        );
    }
}

async function handleWebhook(
    env,
    request
) {
    let update;

    try {
        update =
            await request.json();
    } catch {
        return new Response(
            "Invalid update.",
            { status: 400 }
        );
    }

    try {
        await handleUpdate(
            env,
            update
        );
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : String(error);

        console.error(
            "Telegram update error:",
            message
        );

        await CACHE(env).put(
            "debug:last_error",
            JSON.stringify({
                time: new Date().toISOString(),
                error: message,
                update
            }),
            {
                expirationTtl: 600
            }
        );
    }

    return new Response("OK");
}

export default {
    async fetch(
        request,
        env
    ) {
        const url =
            new URL(
                request.url
            );

        if (
            url.pathname === "/debug/webhook" &&
            request.method === "GET"
        ) {
            try {
                const token =
                    await BOT_TOKEN(env);
        
                const me =
                    await telegram(
                        env,
                        "getMe"
                    );
        
                return Response.json({
                    tokenType:
                        typeof token,
        
                    tokenLength:
                        typeof token === "string"
                            ? token.length
                            : null,
        
                    tokenFormat:
                        typeof token === "string"
                            ? /^\d+:[A-Za-z0-9_-]+$/.test(
                                  token
                              )
                            : false,
        
                    tokenPrefix:
                        typeof token === "string"
                            ? token.slice(0, 10)
                            : null,
        
                    botId:
                        me.id,
        
                    botUsername:
                        me.username
                });
            } catch (error) {
                return Response.json(
                    {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    },
                    {
                        status: 500
                    }
                );
            }
        }

        if (
            request.method === "POST" &&
            url.pathname ===
                "/telegram/webhook"
        ) {
            return handleWebhook(
                env,
                request
            );
        }

        if (
            url.pathname ===
                "/api/crop/image" &&
            request.method === "GET"
        ) {
            return handleCropImage(
                env,
                request,
                url
            );
        }

        if (
            url.pathname ===
                "/api/crop/submit" &&
            request.method === "POST"
        ) {
            return handleCropSubmit(
                env,
                request
            );
        }

        if (
            url.pathname ===
                "/api/crop/cancel" &&
            request.method === "POST"
        ) {
            let body;

            try {
                body =
                    await request.json();
            } catch {
                return new Response(
                    "Invalid request.",
                    { status: 400 }
                );
            }

            return handleCropCancel(
                env,
                request,
                String(
                    body.session || ""
                )
            );
        }

        if (
            env.ASSETS
        ) {
            return env.ASSETS.fetch(
                request
            );
        }

        return new Response(
            "Not found.",
            { status: 404 }
        );
    }
};
