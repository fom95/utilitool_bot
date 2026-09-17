// ============================================================
// CONFIGURATION
// ============================================================

async function BOT_TOKEN(env) {
    return env.TELEGRAM_BOT_TOKEN.get();
}

const CACHE =
    env => env.UTILITOOL_BOT_CACHE;

const SESSION_TTL =
    15 * 60;


// ============================================================
// TELEGRAM API
// ============================================================

async function telegram(
    env,
    method,
    body = null
) {
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
        method:
            body
                ? "POST"
                : "GET",

        headers: {}
    };

    if (body) {
        options.headers[
            "Content-Type"
        ] =
            "application/json";

        options.body =
            JSON.stringify(body);
    }

    const response =
        await fetch(
            url,
            options
        );

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


async function sendMessage(
    env,
    chatId,
    text,
    extra = {}
) {
    return telegram(
        env,
        "sendMessage",
        {
            chat_id:
                chatId,

            text,

            ...extra
        }
    );
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


async function answerCallback(
    env,
    callbackId
) {
    try {
        await telegram(
            env,
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackId
            }
        );
    } catch {}
}


async function leaveChat(
    env,
    chatId
) {
    try {
        await telegram(
            env,
            "leaveChat",
            {
                chat_id:
                    chatId
            }
        );
    } catch {}
}


async function getFile(
    env,
    fileId
) {
    return telegram(
        env,
        "getFile",
        {
            file_id:
                fileId
        }
    );
}


async function downloadTelegramFile(
    env,
    fileId
) {
    const file =
        await getFile(
            env,
            fileId
        );

    if (!file.file_path) {
        throw new Error(
            "Telegram did not return a file path."
        );
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


async function setChatPhoto(
    env,
    chatId,
    blob
) {
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
                method:
                    "POST",

                body:
                    form
            }
        );

    const data =
        await response.json();

    if (!data.ok) {
        throw new Error(
            data.description ||
            "setChatPhoto failed."
        );
    }

    return data.result;
}


// ============================================================
// UI SYSTEM
//
// This is the main human-editable part of the bot.
//
// Menu:
//
//     Menu({
//         text: "...",
//         buttons: [
//             Button("...", {
//                 action: "..."
//             })
//         ]
//     })
//
// Button:
//
//     Button("...", {
//         action: "..."
//     })
//
// Context:
//
//     ctx.username
//     ctx.user
//     ctx.chat
//     ctx.state
//     ctx.data
//     ctx.env
// ============================================================

function Button(
    text,
    options = {}
) {
    return {
        text,
        ...options
    };
}


function Menu(
    options = {}
) {
    return {
        text:
            typeof options.text === "function"
                ? options.text
                : () =>
                    options.text ||
                    "",

        buttons:
            typeof options.buttons === "function"
                ? options.buttons
                : () =>
                    options.buttons ||
                    []
    };
}


function renderButton(
    button,
    context
) {
    const result = {
        text:
            typeof button.text === "function"
                ? button.text(context)
                : button.text
    };

    if (button.url) {
        result.url =
            typeof button.url === "function"
                ? button.url(context)
                : button.url;
    }

    if (
        button.action !==
        undefined
    ) {
        result.callback_data =
            typeof button.action === "function"
                ? button.action(context)
                : button.action;
    }

    if (
        button.callback !==
        undefined
    ) {
        result.callback_data =
            typeof button.callback === "function"
                ? button.callback(context)
                : button.callback;
    }

    return result;
}


function renderMenu(
    menu,
    context
) {
    const buttons =
        typeof menu.buttons === "function"
            ? menu.buttons(context)
            : menu.buttons || [];

    return {
        text:
            typeof menu.text === "function"
                ? menu.text(context)
                : menu.text,

        reply_markup: {
            inline_keyboard:
                buttons.map(row => {
                    const items =
                        Array.isArray(row)
                            ? row
                            : [row];

                    return items.map(
                        button =>
                            renderButton(
                                button,
                                context
                            )
                    );
                })
        }
    };
}


// ============================================================
// MENU STATE
// ============================================================

function menuStateKey(
    chatId
) {
    return `menu:${String(chatId)}`;
}


async function getMenuState(
    env,
    chatId
) {
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
    state
) {
    await CACHE(env).put(
        menuStateKey(chatId),
        JSON.stringify(state)
    );

    return state;
}


async function updateMenuState(
    env,
    chatId,
    changes
) {
    const existing =
        await getMenuState(
            env,
            chatId
        );

    const state = {
        ...(existing || {}),
        ...changes
    };

    await saveMenuState(
        env,
        chatId,
        state
    );

    return state;
}


async function deleteMenuState(
    env,
    chatId
) {
    await CACHE(env).delete(
        menuStateKey(chatId)
    );
}


// ============================================================
// MENU CONTEXT
// ============================================================

function createMenuContext(
    env,
    {
        chat,
        user = null,
        message = null,
        callback = null,
        state = null,
        data = {}
    }
) {
    const context = {
        env,

        chat,
        user,

        message,
        callback,

        state,

        data,

        chatId:
            chat?.id ??
            null,

        chatType:
            chat?.type ||
            "private",

        userId:
            user?.id ??
            null,

        username:
            user?.username ||
            user?.first_name ||
            "there"
    };

    context.edit =
        async menu => {
            const messageId =
                context.state?.messageId ||
                context.message?.message_id;

            if (!messageId) {
                return null;
            }

            const rendered =
                getMenu(
                    menu,
                    context
                );

            return editMessage(
                env,
                context.chatId,
                messageId,
                rendered
            );
        };

    context.send =
        async menu => {
            const rendered =
                getMenu(
                    menu,
                    context
                );

            const sent =
                await sendMessage(
                    env,
                    context.chatId,
                    rendered.text,
                    {
                        reply_markup:
                            rendered.reply_markup
                    }
                );

            return sent;
        };

    context.setState =
        async changes => {
            context.state =
                await updateMenuState(
                    env,
                    context.chatId,
                    changes
                );

            return context.state;
        };

    context.show =
        async menu => {
            return context.edit(
                menu
            );
        };

    return context;
}


// ============================================================
// MENU CREATION / RENDERING
// ============================================================

function getMenu(
    menuName,
    context
) {
    const menu =
        Menus[menuName];

    if (!menu) {
        throw new Error(
            `Unknown menu: ${menuName}`
        );
    }

    return renderMenu(
        menu,
        context
    );
}


async function createMenu(
    env,
    {
        menu,
        chat,
        user = null,
        message = null,
        callback = null,
        state = null,
        data = {}
    }
) {
    const context =
        createMenuContext(
            env,
            {
                chat,
                user,
                message,
                callback,
                state,
                data
            }
        );

    const rendered =
        getMenu(
            menu,
            context
        );

    const sent =
        await sendMessage(
            env,
            chat.id,
            rendered.text,
            {
                reply_markup:
                    rendered.reply_markup
            }
        );

    const newState = {
        ...(state || {}),

        chatId:
            chat.id,

        messageId:
            sent.message_id,

        username:
            context.username,

        lastUserId:
            user?.id != null
                ? Number(user.id)
                : state?.lastUserId ||
                  null,

        lastUsername:
            user?.username ||
            state?.lastUsername ||
            null,

        chatType:
            chat.type,

        mode:
            menu
    };

    await saveMenuState(
        env,
        chat.id,
        newState
    );

    return sent;
}


async function editMenu(
    env,
    {
        menu,
        chat,
        user = null,
        message = null,
        callback = null,
        state = null,
        data = {}
    }
) {
    const context =
        createMenuContext(
            env,
            {
                chat,
                user,
                message,
                callback,
                state,
                data
            }
        );

    const rendered =
        getMenu(
            menu,
            context
        );

    const messageId =
        state?.messageId ||
        message?.message_id;

    if (!messageId) {
        return null;
    }

    await editMessage(
        env,
        chat.id,
        messageId,
        rendered
    );

    return messageId;
}


async function createBaseMenu(
    env,
    chatId,
    username,
    userId = null,
    chatType = "private"
) {
    return createMenu(
        env,
        {
            menu:
                "base",

            chat: {
                id:
                    chatId,

                type:
                    chatType
            },

            user: {
                id:
                    userId,

                username
            }
        }
    );
}


async function showBaseMenu(
    env,
    chatId,
    username,
    userId = null,
    chatType = "private"
) {
    let existing = null;

    for (
        let attempt = 0;
        attempt < 4;
        attempt++
    ) {
        existing =
            await getMenuState(
                env,
                chatId
            );

        if (
            existing?.messageId
        ) {
            break;
        }

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    150 *
                        (attempt + 1)
                )
        );
    }

    if (
        existing?.messageId
    ) {
        try {
            await deleteMessage(
                env,
                chatId,
                existing.messageId
            );
        } catch (error) {
            console.error(
                "Unable to delete previous menu:",
                error
            );
        }
    }

    const message =
        await createMenu(
            env,
            {
                menu:
                    "base",

                chat: {
                    id:
                        chatId,

                    type:
                        chatType
                },

                user: {
                    id:
                        userId,

                    username
                }
            }
        );

    return message.message_id;
}


// ============================================================
// MENUS
//
// THIS is where new bot content should primarily be added.
//
// Add a new menu:
//
//     settings: Menu({
//         text: "Settings",
//         buttons: [
//             Button("Something", {
//                 action: "something"
//             })
//         ]
//     })
//
// Then add its action in Actions below.
// ============================================================

const Menus = {

    // --------------------------------------------------------
    // BASE MENU
    // --------------------------------------------------------

    base:
        Menu({
            text:
                ctx =>
                    `@${ctx.username}, what would you like me to do?`,

            buttons:
                ctx => {
                    if (
                        ctx.chatType ===
                        "private"
                    ) {
                        return [
                            Button(
                                "➕ Add to Group",
                                {
                                    url:
                                        "https://t.me/utilitool_bot?startgroup=setup&admin=change_info+delete_messages"
                                }
                            ),

                            Button(
                                "📢 Add to Channel",
                                {
                                    url:
                                        "https://t.me/utilitool_bot?startchannel&admin=change_info+post_messages+edit_messages+delete_messages"
                                }
                            )
                        ];
                    }

                    return [
                        [
                            Button(
                                "Change Profile Photo",
                                {
                                    action:
                                        "photo"
                                }
                            )
                        ],

                        [
                            Button(
                                "Bye",
                                {
                                    action:
                                        "bye"
                                }
                            )
                        ]
                    ];
                }
        }),


    // --------------------------------------------------------
    // BYE CONFIRMATION
    // --------------------------------------------------------

    bye:
        Menu({
            text:
                "Are you sure you want me to leave?",

            buttons: [
                [
                    Button(
                        "Yes",
                        {
                            action:
                                "bye_confirm"
                        }
                    ),

                    Button(
                        "No",
                        {
                            action:
                                "bye_cancel"
                        }
                    )
                ]
            ]
        }),


    // --------------------------------------------------------
    // PHOTO INPUT
    // --------------------------------------------------------

    photo:
        Menu({
            text:
                "Reply to the image or image document you want to use with @utilitool_bot.",

            buttons: [
                Button(
                    "Cancel",
                    {
                        action:
                            "cancel_photo"
                    }
                )
            ]
        }),


    // --------------------------------------------------------
    // IMAGE CROP
    // --------------------------------------------------------

    crop:
        Menu({
            text:
                "Position the square over the part of the image you want to use, then press Apply.",

            buttons:
                ctx => [
                    Button(
                        "Open Photo Cropper",
                        {
                            url:
                                `https://t.me/utilitool_bot/main?startapp=${encodeURIComponent(ctx.data.sessionId)}`
                        }
                    ),

                    Button(
                        "Cancel",
                        {
                            action:
                                ctx =>
                                    `cancel_photo:${ctx.data.sessionId}`
                        }
                    )
                ]
        })
};


// ============================================================
// MENU ACTIONS
//
// Buttons point here using:
//
//     Button("...", {
//         action: "photo"
//     })
//
// Actions receive the full context:
//
//     ctx.env
//     ctx.chat
//     ctx.user
//     ctx.message
//     ctx.callback
//     ctx.state
//     ctx.data
//     ctx.chatId
//     ctx.chatType
//     ctx.userId
//     ctx.username
//
// Dynamic button actions can additionally receive parameters.
// ============================================================

const Actions = {

    // --------------------------------------------------------
    // CHANGE PROFILE PHOTO
    // --------------------------------------------------------

    photo:
        async ctx => {
            await ctx.setState({
                username:
                    ctx.username,

                lastUserId:
                    Number(
                        ctx.userId
                    ),

                lastUsername:
                    ctx.user?.username ||
                    null,

                requesterId:
                    Number(
                        ctx.userId
                    ),

                requesterUsername:
                    ctx.user?.username ||
                    null,

                mode:
                    "waiting_for_photo"
            });

            await ctx.edit(
                Menus.photo
            );
        },


    // --------------------------------------------------------
    // CANCEL PHOTO SELECTION
    // --------------------------------------------------------

    cancel_photo:
        async ctx => {
            await ctx.setState({
                username:
                    ctx.username,

                lastUserId:
                    Number(
                        ctx.userId
                    ),

                lastUsername:
                    ctx.user?.username ||
                    null,

                mode:
                    "base"
            });

            await ctx.edit(
                Menus.base
            );
        },


    // --------------------------------------------------------
    // CANCEL PHOTO CROP
    //
    // This receives the session ID from:
    //
    //     cancel_photo:SESSION_ID
    // --------------------------------------------------------

    cancel_photo_session:
        async ctx => {
            const sessionId =
                ctx.data.sessionId;

            if (sessionId) {
                await deleteSession(
                    ctx.env,
                    sessionId
                );
            }

            await ctx.setState({
                username:
                    ctx.username,

                lastUserId:
                    Number(
                        ctx.userId
                    ),

                lastUsername:
                    ctx.user?.username ||
                    null,

                mode:
                    "base"
            });

            await ctx.edit(
                Menus.base
            );
        },


    // --------------------------------------------------------
    // SHOW BYE CONFIRMATION
    // --------------------------------------------------------

    bye:
        async ctx => {
            await ctx.setState({
                mode:
                    "confirm_bye"
            });

            await ctx.edit(
                Menus.bye
            );
        },


    // --------------------------------------------------------
    // CANCEL BYE
    // --------------------------------------------------------

    bye_cancel:
        async ctx => {
            await ctx.setState({
                mode:
                    "base"
            });

            await ctx.edit(
                Menus.base
            );
        },


    // --------------------------------------------------------
    // CONFIRM BYE
    // --------------------------------------------------------

    bye_confirm:
        async ctx => {
            try {
                await deleteMessage(
                    ctx.env,
                    ctx.chatId,
                    ctx.state?.messageId ||
                        ctx.message?.message_id
                );
            } catch (error) {
                console.error(
                    "Unable to delete goodbye menu:",
                    error
                );
            }

            await deleteMenuState(
                ctx.env,
                ctx.chatId
            );

            await leaveChat(
                ctx.env,
                ctx.chatId
            );
        }
};


// ============================================================
// ACTION PARSING
// ============================================================

function parseAction(
    value
) {
    const parts =
        String(value || "")
            .split(":");

    return {
        name:
            parts.shift() ||
            "",

        parameters:
            parts
    };
}


function resolveAction(
    name,
    parameters
) {
    /*
     * Normal actions:
     *
     *     photo
     *     bye
     *     bye_cancel
     *
     * Dynamic actions:
     *
     *     cancel_photo:SESSION_ID
     */

    if (
        name ===
        "cancel_photo" &&
        parameters.length
    ) {
        return {
            action:
                Actions.cancel_photo_session,

            data: {
                sessionId:
                    parameters[0]
            }
        };
    }

    return {
        action:
            Actions[name],

        data: {}
    };
}


// ============================================================
// CALLBACK HANDLING
// ============================================================

async function handleMenuAction(
    env,
    callback
) {
    const chat =
        callback.message?.chat;

    if (!chat?.id) {
        await answerCallback(
            env,
            callback.id
        );

        return;
    }

    const state =
        await getMenuState(
            env,
            chat.id
        );

    const parsed =
        parseAction(
            callback.data
        );

    const resolved =
        resolveAction(
            parsed.name,
            parsed.parameters
        );

    if (
        typeof resolved.action !==
        "function"
    ) {
        await answerCallback(
            env,
            callback.id
        );

        return;
    }

    const context =
        createMenuContext(
            env,
            {
                chat,

                user:
                    callback.from,

                message:
                    callback.message,

                callback,

                state,

                data:
                    resolved.data
            }
        );

    await answerCallback(
        env,
        callback.id
    );

    await resolved.action(
        context,
        ...parsed.parameters
    );
}


async function handleCallback(
    env,
    callback
) {
    await handleMenuAction(
        env,
        callback
    );
}


// ============================================================
// BOT MENTIONS / COMMANDS
// ============================================================

function isBotMentioned(
    message
) {
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

    return /@utilitool_bot\b/i.test(
        text
    );
}


function parseStartCommand(
    message
) {
    const text =
        String(
            message?.text ||
            ""
        ).trim();

    const match =
        text.match(
            /^\/start(?:@\w+)?(?:\s+(.+))?$/i
        );

    if (!match) {
        return null;
    }

    return {
        parameter:
            match[1]?.trim() ||
            null
    };
}


async function handleStartCommand(
    env,
    message
) {
    const start =
        parseStartCommand(
            message
        );

    if (!start) {
        return false;
    }

    const chat =
        message.chat;

    const user =
        message.from;

    if (!chat?.id) {
        return true;
    }

    if (
        chat.type ===
        "private"
    ) {
        await showBaseMenu(
            env,
            chat.id,
            user?.username ||
                user?.first_name ||
                "there",
            user?.id ||
                null,
            chat.type
        );

        return true;
    }

    /*
     * /startgroup=setup causes Telegram
     * to send:
     *
     *     /start@utilitool_bot setup
     *
     * after the bot has been added.
     */

    if (
        start.parameter ===
        "setup"
    ) {
        const chatType =
            chat.type;

        if (
            chatType !==
                "group" &&
            chatType !==
                "supergroup"
        ) {
            return true;
        }

        await sendMessage(
            env,
            chat.id,
            "✅ Utilitool is ready.\n\n" +
            "I can now change this group's profile photo.\n\n" +
            "Reply to an image with @utilitool_bot to use it as the new profile photo."
        );

        return true;
    }

    return true;
}


// ============================================================
// SESSION STORAGE
// ============================================================

function randomId() {
    return crypto.randomUUID();
}


async function saveSession(
    env,
    id,
    data
) {
    await CACHE(env).put(
        `crop:${id}`,
        JSON.stringify(data),
        {
            expirationTtl:
                SESSION_TTL
        }
    );
}


async function getSession(
    env,
    id
) {
    const value =
        await CACHE(env).get(
            `crop:${id}`
        );

    if (!value) {
        return null;
    }

    try {
        return JSON.parse(
            value
        );
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


// ============================================================
// IMAGE REPLY HANDLING
// ============================================================

function getReplyImage(
    message
) {
    const reply =
        message.reply_to_message;

    if (!reply) {
        return null;
    }

    if (
        Array.isArray(
            reply.photo
        ) &&
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
            document.mime_type ||
            ""
        ).toLowerCase();

    const fileName =
        String(
            document.file_name ||
            ""
        ).toLowerCase();

    const imageExtension =
        /\.(?:jpg|jpeg|png|webp|gif|bmp|tiff|tif|avif)$/i;

    if (
        mimeType.startsWith(
            "image/"
        ) ||
        imageExtension.test(
            fileName
        )
    ) {
        return {
            file_id:
                document.file_id,

            file_size:
                document.file_size ||
                0
        };
    }

    return null;
}


function getUserFromMessage(
    message
) {
    return message.from || null;
}


// ============================================================
// PHOTO REPLY
// ============================================================

async function handlePhotoReply(
    env,
    message
) {
    const chatId =
        message.chat?.id;

    console.log(
        "handlePhotoReply:",
        JSON.stringify({
            chatId,

            messageId:
                message.message_id,

            fromId:
                message.from?.id
        })
    );

    if (!chatId) {
        return;
    }

    const menuState =
        await getMenuState(
            env,
            chatId
        );

    console.log(
        "PHOTO REPLY MENU STATE:",
        JSON.stringify(
            menuState
        )
    );

    if (!menuState) {
        console.log(
            "PHOTO REPLY STOP: no menu state"
        );

        return;
    }

    if (
        menuState.mode !==
        "waiting_for_photo"
    ) {
        console.log(
            "PHOTO REPLY STOP: wrong menu mode:",
            menuState.mode
        );

        return;
    }

    if (
        !menuState.requesterId
    ) {
        console.log(
            "PHOTO REPLY STOP: no requester ID"
        );

        return;
    }

    if (
        message.from?.id != null &&
        Number(message.from.id) !==
            Number(menuState.requesterId)
    ) {
        console.log(
            "PHOTO REPLY STOP: requester mismatch:",
            message.from.id,
            menuState.requesterId
        );

        return;
    }

    const photo =
        getReplyImage(
            message
        );

    console.log(
        "PHOTO REPLY IMAGE:",
        JSON.stringify(photo)
    );

    if (!photo) {
        await sendMessage(
            env,
            chatId,
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
            chatId,
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
            chatId,

            chatType:
                menuState.chatType ||
                message.chat?.type ||
                "private",

            fileId:
                photo.file_id,

            userId:
                Number(
                    message.from?.id ||
                    menuState.requesterId
                ),

            username:
                message.from?.username ||
                menuState.lastUsername ||
                menuState.requesterUsername ||
                null,

            firstName:
                message.from?.first_name ||
                null,

            menuMessageId:
                menuState.messageId
        }
    );

    console.log(
        "PHOTO REPLY SESSION SAVED:",
        sessionId
    );

    try {
        await deleteMessage(
            env,
            chatId,
            message.message_id
        );

        console.log(
            "PHOTO REPLY DELETED:",
            message.message_id
        );
    } catch (error) {
        console.error(
            "Unable to delete photo reply:",
            error instanceof Error
                ? error.message
                : String(error)
        );
    }

    const context =
        createMenuContext(
            env,
            {
                chat:
                    message.chat,

                user:
                    message.from,

                message,

                state:
                    menuState,

                data: {
                    sessionId
                }
            }
        );

    try {
        await context.edit(
            Menus.crop
        );

        console.log(
            "PHOTO MENU CHANGED TO CROP MENU"
        );
    } catch (error) {
        console.error(
            "Unable to edit crop menu:",
            error instanceof Error
                ? error.message
                : String(error)
        );

        console.error(
            "Crop menu edit details:",
            JSON.stringify({
                chatId,

                messageId:
                    menuState.messageId,

                sessionId
            })
        );

        return;
    }

    await updateMenuState(
        env,
        chatId,
        {
            mode:
                "crop",

            sessionId
        }
    );

    console.log(
        "PHOTO REPLY COMPLETE"
    );
}


// ============================================================
// TELEGRAM MINI APP AUTHENTICATION
// ============================================================

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
        params.get(
            "hash"
        );

    if (!receivedHash) {
        throw new Error(
            "Missing Telegram initialization hash."
        );
    }

    params.delete(
        "hash"
    );

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
                name:
                    "HMAC",

                hash:
                    "SHA-256"
            },
            false,
            [
                "sign"
            ]
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
                name:
                    "HMAC",

                hash:
                    "SHA-256"
            },
            false,
            [
                "sign"
            ]
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

    if (
        difference !== 0
    ) {
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
        params.get(
            "user"
        );

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


function getInitData(
    request
) {
    return (
        request.headers.get(
            "X-Telegram-Init-Data"
        ) ||

        request.headers
            .get(
                "Authorization"
            )
            ?.replace(
                /^tma\s+/i,
                ""
            ) ||

        ""
    );
}


async function authorizeSession(
    env,
    request,
    session
) {
    const initData =
        getInitData(
            request
        );

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


// ============================================================
// CROP IMAGE ENDPOINT
// ============================================================

async function handleCropImage(
    env,
    request,
    url
) {
    const sessionId =
        url.searchParams.get(
            "session"
        );

    console.log(
        "CROP IMAGE REQUEST:",
        sessionId
    );

    if (!sessionId) {
        console.error(
            "CROP IMAGE: missing session"
        );

        return new Response(
            "Missing session.",
            {
                status:
                    400
            }
        );
    }

    const session =
        await getSession(
            env,
            sessionId
        );

    console.log(
        "CROP IMAGE SESSION:",
        JSON.stringify(
            session
                ? {
                    chatId:
                        session.chatId,

                    userId:
                        session.userId,

                    fileId:
                        session.fileId,

                    menuMessageId:
                        session.menuMessageId
                }
                : null
        )
    );

    if (!session) {
        console.error(
            "CROP IMAGE: session not found"
        );

        return new Response(
            "Crop session expired.",
            {
                status:
                    410
            }
        );
    }

    try {
        await authorizeSession(
            env,
            request,
            session
        );

        console.log(
            "CROP IMAGE: authorization successful"
        );
    } catch (error) {
        console.error(
            "CROP IMAGE: authorization failed:",
            error
        );

        return new Response(
            error.message,
            {
                status:
                    403
            }
        );
    }

    try {
        console.log(
            "CROP IMAGE: calling Telegram getFile"
        );

        const {
            response,
            file
        } =
            await downloadTelegramFile(
                env,
                session.fileId
            );

        console.log(
            "CROP IMAGE: Telegram response:",
            JSON.stringify({
                filePath:
                    file.file_path,

                fileSize:
                    file.file_size,

                contentType:
                    response.headers.get(
                        "Content-Type"
                    ),

                contentLength:
                    response.headers.get(
                        "Content-Length"
                    ),

                status:
                    response.status
            })
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
                status:
                    200,

                headers
            }
        );
    } catch (error) {
        console.error(
            "CROP IMAGE: Telegram download failed:",
            error
        );

        return new Response(
            "Unable to retrieve the Telegram image.",
            {
                status:
                    502
            }
        );
    }
}


// ============================================================
// CROP SUBMIT ENDPOINT
// ============================================================

async function handleCropSubmit(
    env,
    request,
    ctx
) {
    let form;

    try {
        form =
            await request.formData();
    } catch {
        return new Response(
            "Invalid form data.",
            {
                status:
                    400
            }
        );
    }

    const sessionId =
        String(
            form.get(
                "session"
            ) ||
            ""
        );

    const initData =
        String(
            form.get(
                "initData"
            ) ||
            ""
        );

    const photo =
        form.get(
            "photo"
        );

    if (!sessionId) {
        return new Response(
            "Missing session.",
            {
                status:
                    400
            }
        );
    }

    if (
        !photo ||
        typeof photo.arrayBuffer !==
            "function"
    ) {
        return new Response(
            "Missing cropped photo.",
            {
                status:
                    400
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
                status:
                    404
            }
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
            {
                status:
                    403
            }
        );
    }

    if (!auth.user?.id) {
        return new Response(
            "Telegram user information is missing.",
            {
                status:
                    403
            }
        );
    }

    if (
        session.userId &&
        Number(session.userId) !==
            Number(auth.user.id)
    ) {
        return new Response(
            "This crop session belongs to another Telegram user.",
            {
                status:
                    403
            }
        );
    }

    if (
        photo.size >
        5 * 1024 * 1024
    ) {
        return new Response(
            "Cropped image is too large.",
            {
                status:
                    413
            }
        );
    }

    if (
        photo.type !==
        "image/jpeg"
    ) {
        return new Response(
            "The cropped image must be JPEG.",
            {
                status:
                    400
            }
        );
    }

    const blob =
        new Blob(
            [
                await photo.arrayBuffer()
            ],
            {
                type:
                    "image/jpeg"
            }
        );

    try {
        console.log(
            "CROP SUBMIT: setting chat photo"
        );

        await setChatPhoto(
            env,
            session.chatId,
            blob
        );

        console.log(
            "CROP SUBMIT: chat photo changed successfully"
        );
    } catch (error) {
        console.error(
            "setChatPhoto error:",
            error
        );

        return Response.json(
            {
                success:
                    false,

                error:
                    error instanceof Error
                        ? error.message
                        : String(error)
            },
            {
                status:
                    502
            }
        );
    }

    await deleteSession(
        env,
        sessionId
    );

    const username =
        auth.user.username ||
        session.username ||
        null;

    const displayName =
        username ||
        auth.user.first_name ||
        session.firstName ||
        "User";

    /*
     * The photo change itself succeeded.
     *
     * Do not make the Mini App wait for Telegram
     * menu cleanup/recreation.
     */

    ctx.waitUntil(
        (async () => {
            if (
                session.menuMessageId
            ) {
                try {
                    await deleteMessage(
                        env,
                        session.chatId,
                        session.menuMessageId
                    );

                    console.log(
                        "CROP SUBMIT: old menu deleted:",
                        session.menuMessageId
                    );
                } catch (error) {
                    console.error(
                        "Unable to delete old menu after photo change:",
                        error
                    );
                }
            }

            try {
                const newMenu =
                    await createBaseMenu(
                        env,
                        session.chatId,
                        displayName,
                        auth.user.id,
                        session.chatType ||
                            "private"
                    );

                console.log(
                    "CROP SUBMIT: new menu created:",
                    newMenu.message_id
                );
            } catch (error) {
                console.error(
                    "Unable to create new base menu after photo change:",
                    error
                );
            }
        })()
    );

    return Response.json({
        success:
            true
    });
}


// ============================================================
// CROP CANCEL ENDPOINT
// ============================================================

async function handleCropCancel(
    env,
    request,
    sessionId
) {
    if (!sessionId) {
        return new Response(
            "Missing session.",
            {
                status:
                    400
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
                status:
                    410
            }
        );
    }

    let auth;

    try {
        auth =
            await authorizeSession(
                env,
                request,
                session
            );
    } catch (error) {
        return new Response(
            error.message,
            {
                status:
                    403
            }
        );
    }

    await deleteSession(
        env,
        sessionId
    );

    const username =
        auth.user?.username ||
        session.username ||
        null;

    const displayName =
        username ||
        auth.user?.first_name ||
        session.firstName ||
        "User";

    const chatType =
        session.chatType ||
        "private";

    if (
        session.menuMessageId
    ) {
        try {
            await editMenu(
                env,
                {
                    menu:
                        "base",

                    chat: {
                        id:
                            session.chatId,

                        type:
                            chatType
                    },

                    user:
                        auth.user,

                    state: {
                        messageId:
                            session.menuMessageId
                    }
                }
            );

            await saveMenuState(
                env,
                session.chatId,
                {
                    chatId:
                        session.chatId,

                    messageId:
                        session.menuMessageId,

                    username:
                        username ||
                        displayName,

                    lastUserId:
                        Number(
                            auth.user.id
                        ),

                    lastUsername:
                        username ||
                        null,

                    chatType,

                    mode:
                        "base"
                }
            );
        } catch (error) {
            console.error(
                "Unable to restore base menu:",
                error
            );

            await saveMenuState(
                env,
                session.chatId,
                {
                    chatId:
                        session.chatId,

                    messageId:
                        session.menuMessageId,

                    username:
                        username ||
                        displayName,

                    lastUserId:
                        Number(
                            auth.user.id
                        ),

                    lastUsername:
                        username ||
                        null,

                    chatType,

                    mode:
                        "base"
                }
            );
        }
    }

    return Response.json({
        success:
            true
    });
}


// ============================================================
// CHAT MEMBERSHIP
// ============================================================

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
        ].includes(
            newStatus
        )
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
        username,
        null,
        chat.type
    );
}


// ============================================================
// MESSAGE HANDLING
// ============================================================

async function handleMessage(
    env,
    message
) {
    console.log(
        "MESSAGE:",
        JSON.stringify({
            messageId:
                message.message_id,

            chatId:
                message.chat?.id,

            chatType:
                message.chat?.type,

            fromId:
                message.from?.id,

            text:
                message.text,

            caption:
                message.caption,

            hasReply:
                !!message.reply_to_message,

            replyId:
                message.reply_to_message?.message_id,

            replyHasPhoto:
                Array.isArray(
                    message.reply_to_message?.photo
                ) &&
                message.reply_to_message.photo.length > 0,

            replyHasDocument:
                !!message.reply_to_message?.document
        })
    );

    const chat =
        message.chat;

    const chatId =
        chat?.id;

    if (!chatId) {
        return;
    }

    const text =
        String(
            message.text ||
            ""
        ).trim();

    /*
     * /start always works in a private DM.
     */

    if (
        chat.type ===
            "private" &&
        /^\/start(?:@\w+)?(?:\s+.+)?$/i.test(
            text
        )
    ) {
        await handleStartCommand(
            env,
            message
        );

        return;
    }

    /*
     * Replies to images require
     * the bot to be mentioned.
     */

    if (
        message.reply_to_message
    ) {
        console.log(
            "MESSAGE IS A REPLY"
        );

        console.log(
            "BOT MENTIONED:",
            isBotMentioned(
                message
            )
        );

        if (
            !isBotMentioned(
                message
            )
        ) {
            return;
        }

        await handlePhotoReply(
            env,
            message
        );

        return;
    }

    /*
     * Normal menu summons require
     * @utilitool_bot in groups/channels.
     */

    if (
        !isBotMentioned(
            message
        )
    ) {
        return;
    }

    try {
        await deleteMessage(
            env,
            chatId,
            message.message_id
        );
    } catch (error) {
        console.error(
            "Unable to delete menu summon message:",
            error
        );
    }

    const username =
        message.from?.username ||
        "there";

    await showBaseMenu(
        env,
        chatId,
        username,
        message.from?.id ||
            null,
        chat.type
    );
}


// ============================================================
// UPDATE HANDLING
// ============================================================

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


// ============================================================
// WEBHOOK
// ============================================================

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
            {
                status:
                    400
            }
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
                time:
                    new Date().toISOString(),

                error:
                    message,

                update
            }),
            {
                expirationTtl:
                    600
            }
        );
    }

    return new Response(
        "OK"
    );
}


// ============================================================
// WORKER
// ============================================================

export default {

    async fetch(
        request,
        env,
        ctx
    ) {
        const url =
            new URL(
                request.url
            );


        // ----------------------------------------------------
        // DEBUG
        // ----------------------------------------------------

        if (
            url.pathname ===
                "/debug/webhook" &&
            request.method ===
                "GET"
        ) {
            try {
                const token =
                    await BOT_TOKEN(
                        env
                    );

                const me =
                    await telegram(
                        env,
                        "getMe"
                    );

                return Response.json({
                    tokenType:
                        typeof token,

                    tokenLength:
                        typeof token ===
                        "string"
                            ? token.length
                            : null,

                    tokenFormat:
                        typeof token ===
                        "string"
                            ? /^\d+:[A-Za-z0-9_-]+$/.test(
                                token
                            )
                            : false,

                    tokenPrefix:
                        typeof token ===
                        "string"
                            ? token.slice(
                                0,
                                10
                            )
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
                        status:
                            500
                    }
                );
            }
        }


        // ----------------------------------------------------
        // TELEGRAM WEBHOOK
        // ----------------------------------------------------

        if (
            request.method ===
                "POST" &&
            url.pathname ===
                "/telegram/webhook"
        ) {
            return handleWebhook(
                env,
                request
            );
        }


        // ----------------------------------------------------
        // CROP IMAGE
        // ----------------------------------------------------

        if (
            url.pathname ===
                "/api/crop/image" &&
            request.method ===
                "GET"
        ) {
            return handleCropImage(
                env,
                request,
                url
            );
        }


        // ----------------------------------------------------
        // CROP SUBMIT
        // ----------------------------------------------------

        if (
            url.pathname ===
                "/api/crop/submit" &&
            request.method ===
                "POST"
        ) {
            return handleCropSubmit(
                env,
                request,
                ctx
            );
        }


        // ----------------------------------------------------
        // CROP CANCEL
        // ----------------------------------------------------

        if (
            url.pathname ===
                "/api/crop/cancel" &&
            request.method ===
                "POST"
        ) {
            let body;

            try {
                body =
                    await request.json();
            } catch {
                return new Response(
                    "Invalid request.",
                    {
                        status:
                            400
                    }
                );
            }

            return handleCropCancel(
                env,
                request,
                String(
                    body.session ||
                    ""
                )
            );
        }


        // ----------------------------------------------------
        // STATIC ASSETS
        // ----------------------------------------------------

        if (env.ASSETS) {
            return env.ASSETS.fetch(
                request
            );
        }


        // ----------------------------------------------------
        // NOT FOUND
        // ----------------------------------------------------

        return new Response(
            "Not found.",
            {
                status:
                    404
            }
        );
    }
};
