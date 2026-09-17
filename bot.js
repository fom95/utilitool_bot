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
    menu,
    context
) {
    const template =
        Menus[menu];

    if (!template) {
        throw new Error(
            `Unknown menu: ${menu}`
        );
    }

    return renderMenu(
        template,
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
                                "🖼️ Profile Photo Library",
                                {
                                    action:
                                        "library"
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
    // PROFILE PHOTO LIBRARY
    // --------------------------------------------------------

    library:
    Menu({
        text:
            "Choose a saved profile photo to use for this chat.",
        buttons:
            ctx => [
                Button("🖼️ Open Photo Library", {
                    url:
                        `https://t.me/utilitool_bot/main?startapp=library_${encodeURIComponent(String(ctx.chatId))}`
                }),
                Button("Cancel", {
                    action:
                        "library_cancel"
                })
            ]
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
                "photo"
            );
        },


    // --------------------------------------------------------
    // OPEN PROFILE PHOTO LIBRARY
    // --------------------------------------------------------

    library:
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
                    "library"
            });

            await ctx.edit(
                "library"
            );
        },


    // --------------------------------------------------------
    // CANCEL PROFILE PHOTO LIBRARY
    // --------------------------------------------------------

    library_cancel:
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
                "base"
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
                "base"
            );
        },


    // --------------------------------------------------------
    // CANCEL PHOTO CROP
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
                "base"
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
                "bye"
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
                "base"
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

    return false;
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

    // --------------------------------------------------------
    // Normal photo message
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Chat profile photo service message
    //
    // Telegram provides this as:
    //
    //     new_chat_photo: PhotoSize[]
    //
    // This is the square image that was used as
    // the chat's profile photo.
    // --------------------------------------------------------

    if (
        Array.isArray(
            reply.new_chat_photo
        ) &&
        reply.new_chat_photo.length
    ) {
        return reply.new_chat_photo
            .slice()
            .sort(
                (a, b) =>
                    (b.file_size || 0) -
                    (a.file_size || 0)
            )[0];
    }

    // --------------------------------------------------------
    // Image document
    // --------------------------------------------------------

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
            "crop"
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

function getLibraryChatId(auth) {
    const startParam =
        auth.params.get("start_param");

    if (!startParam) {
        throw new Error(
            "Missing library launch parameter."
        );
    }

    const match =
        startParam.match(
            /^library_(-?\d+)$/
        );

    if (!match) {
        throw new Error(
            "Invalid library launch parameter."
        );
    }

    return match[1];
}

async function authorizeLibrary(
    env,
    request
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

    const chatId =
        getLibraryChatId(auth);

    const {
        owner,
        chat
    } =
        await resolveProfileLibraryOwner(
            env,
            chatId
        );

    return {
        auth,
        chatId,
        chat,
        owner
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

async function handleLibrary(
    env,
    request
) {
    const {
        chatId,
        chat,
        owner
    } =
        await authorizeLibrary(
            env,
            request
        );

    const library =
        await getProfileLibrary(
            env,
            owner.id
        );

    const chats =
        await getProfileOwnerChats(
            env,
            owner.id
        );

    return json({
        success: true,

        currentChat: {
            id:
                chat.id,

            type:
                chat.type ||
                null,

            title:
                chat.title ||
                chat.username ||
                String(chat.id),

            username:
                chat.username ||
                null
        },

        owner: {
            id:
                owner.id,

            username:
                owner.username ||
                null,

            firstName:
                owner.first_name ||
                null,

            lastName:
                owner.last_name ||
                null
        },

        chats,

        photos:
            library.map(
                photo => ({
                    id:
                        photo.id,

                    fileId:
                        photo.fileId,

                    thumbFileId:
                        photo.thumbFileId ||
                        photo.fileId,

                    width:
                        photo.width,

                    height:
                        photo.height,

                    fileSize:
                        photo.fileSize,

                    sourceChatId:
                        photo.sourceChatId,

                    sourceChatTitle:
                        photo.sourceChatTitle,

                    sourceChatUsername:
                        photo.sourceChatUsername,

                    createdAt:
                        photo.createdAt
                })
            )
    });
}

async function handleLibraryPhoto(
    env,
    request,
    url
) {
    const {
        owner
    } =
        await authorizeLibrary(
            env,
            request
        );

    const photoId =
        url.searchParams.get(
            "id"
        );

    if (!photoId) {
        return json(
            {
                success: false,
                error:
                    "Missing photo ID."
            },
            400
        );
    }

    const library =
        await getProfileLibrary(
            env,
            owner.id
        );

    const photo =
        library.find(
            item =>
                String(item.id) ===
                String(photoId)
        );

    if (!photo?.fileId) {
        return json(
            {
                success: false,
                error:
                    "Photo not found."
            },
            404
        );
    }

    const blob =
        await downloadTelegramFile(
            env,
            photo.fileId
        );

    return new Response(
        blob,
        {
            headers: {
                "Content-Type":
                    "image/jpeg",

                "Cache-Control":
                    "private, max-age=3600"
            }
        }
    );
}

async function handleLibraryApply(
    env,
    request
) {
    const {
        chatId,
        owner
    } =
        await authorizeLibrary(
            env,
            request
        );

    const form =
        await request.formData();

    const photoId =
        form.get("id");

    const deleteNewChatPhoto =
        form.get(
            "deleteNewChatPhoto"
        ) !== "0";

    if (!photoId) {
        return json(
            {
                success: false,
                error:
                    "Missing photo ID."
            },
            400
        );
    }

    const library =
        await getProfileLibrary(
            env,
            owner.id
        );

    const photo =
        library.find(
            item =>
                String(item.id) ===
                String(photoId)
        );

    if (!photo?.fileId) {
        return json(
            {
                success: false,
                error:
                    "Photo not found."
            },
            404
        );
    }

    const blob =
        await downloadTelegramFile(
            env,
            photo.fileId
        );

    if (!blob) {
        return json(
            {
                success: false,
                error:
                    "Unable to download library photo."
            },
            500
        );
    }

    await setPendingPhotoDelete(
        env,
        chatId,
        owner.id,
        deleteNewChatPhoto,
        false
    );

    await setChatPhoto(
        env,
        chatId,
        blob
    );

    return json({
        success: true
    });
}

async function handleLibraryDelete(
    env,
    request
) {
    const {
        owner
    } =
        await authorizeLibrary(
            env,
            request
        );

    const form =
        await request.formData();

    const photoId =
        form.get("id");

    if (!photoId) {
        return json(
            {
                success: false,
                error:
                    "Missing photo ID."
            },
            400
        );
    }

    const deleted =
        await deleteProfileLibraryPhoto(
            env,
            owner.id,
            photoId
        );

    return json({
        success:
            deleted
    });
}


// ============================================================
// KV HELPERS
// ============================================================

function pendingPhotoDeleteKey(chatId) {
    return `delete_new_chat_photo:${String(chatId)}`;
}

async function setPendingPhotoDelete(
    env,
    chatId,
    userId,
    deleteNewChatPhoto = false,
    saveProfilePhoto = true
) {
    await CACHE(env).put(
        pendingPhotoDeleteKey(chatId),
        JSON.stringify({
            chatId,
            userId,
            deleteNewChatPhoto,
            saveProfilePhoto,
            createdAt: Date.now()
        }),
        {
            expirationTtl: 60
        }
    );
}

async function getPendingPhotoDelete(
    env,
    chatId
) {
    return CACHE(env).get(
        pendingPhotoDeleteKey(chatId),
        "json"
    );
}

async function deletePendingPhotoDelete(
    env,
    chatId
) {
    await CACHE(env).delete(
        pendingPhotoDeleteKey(chatId)
    );
}

function profileOwnerLibraryKey(ownerId) {
    return `profileLibrary:${String(ownerId)}`;
}

function profileOwnerChatsKey(ownerId) {
    return `profileOwnerChats:${String(ownerId)}`;
}

async function getProfileLibrary(
    env,
    ownerId
) {
    const library =
        await CACHE(env).get(
            profileOwnerLibraryKey(ownerId),
            "json"
        );

    return Array.isArray(library)
        ? library
        : [];
}

async function saveProfileLibrary(
    env,
    ownerId,
    library
) {
    await CACHE(env).put(
        profileOwnerLibraryKey(ownerId),
        JSON.stringify(library)
    );

    return library;
}

async function getProfileOwnerChats(
    env,
    ownerId
) {
    const chats =
        await CACHE(env).get(
            profileOwnerChatsKey(ownerId),
            "json"
        );

    return Array.isArray(chats)
        ? chats
        : [];
}

async function saveProfileOwnerChats(
    env,
    ownerId,
    chats
) {
    await CACHE(env).put(
        profileOwnerChatsKey(ownerId),
        JSON.stringify(chats)
    );

    return chats;
}

async function registerProfileOwnerChat(
    env,
    ownerId,
    chat
) {
    if (
        ownerId == null ||
        !chat?.id
    ) {
        return;
    }

    const chats =
        await getProfileOwnerChats(
            env,
            ownerId
        );

    const chatId =
        String(chat.id);

    const existingIndex =
        chats.findIndex(
            item =>
                String(item.id) ===
                chatId
        );

    const entry = {
        id:
            chat.id,

        type:
            chat.type ||
            null,

        title:
            chat.title ||
            chat.username ||
            String(chat.id),

        username:
            chat.username ||
            null,

        updatedAt:
            Date.now()
    };

    if (existingIndex === -1) {
        chats.push(entry);
    } else {
        chats[existingIndex] = {
            ...chats[existingIndex],
            ...entry
        };
    }

    await saveProfileOwnerChats(
        env,
        ownerId,
        chats
    );
}

async function getChatOwner(
    env,
    chatId
) {
    const administrators =
        await telegram(
            env,
            "getChatAdministrators",
            {
                chat_id: chatId
            }
        );

    const owner =
        administrators.find(
            member =>
                member?.status ===
                "creator"
        );

    if (!owner?.user?.id) {
        throw new Error(
            "Unable to determine the owner of this chat."
        );
    }

    return owner.user;
}

async function resolveProfileLibraryOwner(
    env,
    chatId
) {
    const chat =
        await telegram(
            env,
            "getChat",
            {
                chat_id: chatId
            }
        );

    const owner =
        await getChatOwner(
            env,
            chatId
        );

    await registerProfileOwnerChat(
        env,
        owner.id,
        chat
    );

    return {
        owner,
        chat
    };
}

async function addProfileLibraryPhoto(
    env,
    ownerId,
    photo,
    sourceChat
) {
    if (
        !photo ||
        !Array.isArray(photo) ||
        !photo.length
    ) {
        return null;
    }

    const library =
        await getProfileLibrary(
            env,
            ownerId
        );

    const ordered =
        photo
            .slice()
            .sort(
                (a, b) =>
                    (a.file_size || 0) -
                    (b.file_size || 0)
            );

    const thumbnail =
        ordered[0];

    const largest =
        ordered[
            ordered.length - 1
        ];

    if (!largest?.file_id) {
        return null;
    }

    const uniqueId =
        largest.file_unique_id ||
        largest.file_id;

    const duplicate =
        library.some(
            item =>
                (
                    largest.file_unique_id &&
                    item.fileUniqueId ===
                        largest.file_unique_id
                ) ||
                item.fileId ===
                    largest.file_id
        );

    if (duplicate) {
        return null;
    }

    const entry = {
        id:
            crypto.randomUUID(),

        fileId:
            largest.file_id,

        thumbFileId:
            thumbnail?.file_id ||
            largest.file_id,

        fileUniqueId:
            largest.file_unique_id ||
            null,

        width:
            largest.width ||
            null,

        height:
            largest.height ||
            null,

        fileSize:
            largest.file_size ||
            null,

        sourceChatId:
            sourceChat?.id ||
            null,

        sourceChatType:
            sourceChat?.type ||
            null,

        sourceChatTitle:
            sourceChat?.title ||
            sourceChat?.username ||
            null,

        sourceChatUsername:
            sourceChat?.username ||
            null,

        createdAt:
            Date.now()
    };

    library.unshift(entry);

    await saveProfileLibrary(
        env,
        ownerId,
        library
    );

    return entry;
}

async function deleteProfileLibraryPhoto(
    env,
    ownerId,
    photoId
) {
    const library =
        await getProfileLibrary(
            env,
            ownerId
        );

    const updated =
        library.filter(
            item =>
                String(item.id) !==
                String(photoId)
        );

    if (
        updated.length ===
        library.length
    ) {
        return false;
    }

    await saveProfileLibrary(
        env,
        ownerId,
        updated
    );

    return true;
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

    const deleteNewChatPhoto =
        form.get(
            "deleteNewChatPhoto"
        ) === "1";

    const saveProfilePhoto =
        form.get(
            "saveProfilePhoto"
        ) !== "0";

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

        await setPendingPhotoDelete(
            env,
            session.chatId,
            session.userId,
            deleteNewChatPhoto,
            saveProfilePhoto
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

            hasNewChatPhoto:
                Array.isArray(
                    message.new_chat_photo
                ) &&
                message.new_chat_photo.length > 0,

            hasReply:
                !!message.reply_to_message,

            replyId:
                message.reply_to_message?.message_id,

            replyHasPhoto:
                Array.isArray(
                    message.reply_to_message?.photo
                ) &&
                message.reply_to_message.photo.length > 0,

            replyHasNewChatPhoto:
                Array.isArray(
                    message.reply_to_message?.new_chat_photo
                ) &&
                message.reply_to_message.new_chat_photo.length > 0,

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

    /*
     * Telegram creates a service message
     * containing new_chat_photo after the
     * chat profile photo is changed.
     *
     * Handle this before normal message
     * processing so it doesn't get treated
     * as a menu summon or photo reply.
     */

    if (
        Array.isArray(
            message.new_chat_photo
        ) &&
        message.new_chat_photo.length
    ) {
        await handleNewChatPhoto(
            env,
            message
        );

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

async function handleNewChatPhoto(
    env,
    message
) {
    const chatId =
        message.chat?.id;

    const photos =
        message.new_chat_photo;

    if (
        chatId == null ||
        !Array.isArray(photos) ||
        !photos.length
    ) {
        return false;
    }

    const pending =
        await getPendingPhotoDelete(
            env,
            chatId
        );

    try {
        const {
            owner,
            chat
        } =
            await resolveProfileLibraryOwner(
                env,
                chatId
            );

        const shouldSave =
            pending
                ? pending.saveProfilePhoto !== false
                : true;

        if (shouldSave) {
            await addProfileLibraryPhoto(
                env,
                owner.id,
                photos,
                chat
            );
        }
    } catch (error) {
        console.error(
            "Unable to save profile photo to owner library:",
            error
        );
    }

    if (!pending) {
        return true;
    }

    await deletePendingPhotoDelete(
        env,
        chatId
    );

    if (
        !pending.deleteNewChatPhoto
    ) {
        return true;
    }

    if (
        pending.userId &&
        message.from?.id &&
        Number(pending.userId) !==
            Number(message.from.id)
    ) {
        return true;
    }

    const messageId =
        message.message_id;

    if (!messageId) {
        return true;
    }

    try {
        await deleteMessage(
            env,
            chatId,
            messageId
        );
    } catch (error) {
        console.error(
            "Unable to delete new profile-photo message:",
            error
        );
    }

    return true;
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
        // PROFILE PHOTO LIBRARY
        // ----------------------------------------------------

        if (
            url.pathname ===
                "/api/library" &&
            request.method ===
                "GET"
        ) {
            return handleLibrary(
                env,
                request
            );
        }


        // ----------------------------------------------------
        // PROFILE PHOTO LIBRARY IMAGE
        // ----------------------------------------------------

        if (
            url.pathname ===
                "/api/library/photo" &&
            request.method ===
                "GET"
        ) {
            return handleLibraryPhoto(
                env,
                request,
                url
            );
        }


        // ----------------------------------------------------
        // APPLY PROFILE PHOTO FROM LIBRARY
        // ----------------------------------------------------

        if (
            url.pathname ===
                "/api/library/apply" &&
            request.method ===
                "POST"
        ) {
            return handleLibraryApply(
                env,
                request,
                ctx
            );
        }


        // ----------------------------------------------------
        // DELETE PROFILE PHOTO FROM LIBRARY
        // ----------------------------------------------------

        if (
            url.pathname ===
                "/api/library/delete" &&
            request.method ===
                "POST"
        ) {
            return handleLibraryDelete(
                env,
                request
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
