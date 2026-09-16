const TOKEN = env.TELEGRAM_BOT_TOKEN.get();
const sharp =
    require("sharp");

const API =
    `https://api.telegram.org/bot${TOKEN}`;

let offset = 0;

let botId = null;
let botUsername = null;


/* =========================
   Telegram API
========================= */

async function api(method, params = {}) {
    const response =
        await fetch(
            `${API}/${method}`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body:
                    JSON.stringify(params)
            }
        );

    return await response.json();
}


async function sendMessage(
    chatId,
    text,
    replyMarkup = null
) {
    const params = {
        chat_id: chatId,
        text,
        parse_mode: "HTML"
    };

    if (replyMarkup) {
        params.reply_markup =
            replyMarkup;
    }

    const result =
        await api(
            "sendMessage",
            params
        );

    if (result.ok) {
        trackBotMessage(
            chatId,
            result.result.message_id
        );
    }

    return result;
}


async function sendPhoto(
    chatId,
    fileBuffer,
    caption = "",
    replyMarkup = null
) {
    const form =
        new FormData();

    form.append(
        "chat_id",
        String(chatId)
    );

    form.append(
        "photo",
        new Blob(
            [fileBuffer],
            {
                type: "image/jpeg"
            }
        ),
        "preview.jpg"
    );

    if (caption) {
        form.append(
            "caption",
            caption
        );

        form.append(
            "parse_mode",
            "HTML"
        );
    }

    if (replyMarkup) {
        form.append(
            "reply_markup",
            JSON.stringify(
                replyMarkup
            )
        );
    }

    const response =
        await fetch(
            `${API}/sendPhoto`,
            {
                method: "POST",
                body: form
            }
        );

    const result =
        await response.json();

    if (result.ok) {
        trackBotMessage(
            chatId,
            result.result.message_id
        );
    }

    return result;
}


async function answerCallback(
    callbackId,
    text = ""
) {
    return await api(
        "answerCallbackQuery",
        {
            callback_query_id:
                callbackId,
            text
        }
    );
}


async function deleteMessage(
    chatId,
    messageId
) {
    return await api(
        "deleteMessage",
        {
            chat_id: chatId,
            message_id: messageId
        }
    );
}


async function leaveChat(chatId) {
    return await api(
        "leaveChat",
        {
            chat_id: chatId
        }
    );
}


/* =========================
   Media
========================= */

async function setChatPhoto(
    chatId,
    fileBuffer
) {
    const form =
        new FormData();

    form.append(
        "chat_id",
        String(chatId)
    );

    form.append(
        "photo",
        new Blob(
            [fileBuffer],
            {
                type: "image/jpeg"
            }
        ),
        "photo.jpg"
    );

    const response =
        await fetch(
            `${API}/setChatPhoto`,
            {
                method: "POST",
                body: form
            }
        );

    return await response.json();
}


async function downloadTelegramPhoto(
    fileId
) {
    const file =
        await api(
            "getFile",
            {
                file_id: fileId
            }
        );

    if (!file.ok) {
        throw new Error(
            `getFile failed: ${
                file.description ||
                "Unknown error"
            }`
        );
    }

    const response =
        await fetch(
            `https://api.telegram.org/file/bot${TOKEN}/${file.result.file_path}`
        );

    if (!response.ok) {
        throw new Error(
            `Download failed: ${
                response.status
            } ${
                response.statusText
            }`
        );
    }

    return Buffer.from(
        await response.arrayBuffer()
    );
}


/* =========================
   Menus
========================= */

function mainMenu() {
    return {
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
                    text: "Bye",
                    callback_data:
                        "bye"
                }
            ]
        ]
    };
}


function photoMenu() {
    return {
        inline_keyboard: [
            [
                {
                    text: "Cancel",
                    callback_data:
                        "cancel"
                }
            ]
        ]
    };
}


function cropMenu() {
    return {
        inline_keyboard: [
            [
                {
                    text: "◀",
                    callback_data:
                        "crop:left"
                },
                {
                    text: "▶",
                    callback_data:
                        "crop:right"
                }
            ],
            [
                {
                    text: "▲",
                    callback_data:
                        "crop:up"
                },
                {
                    text: "▼",
                    callback_data:
                        "crop:down"
                }
            ],
            [
                {
                    text: "−",
                    callback_data:
                        "crop:zoomout"
                },
                {
                    text: "+",
                    callback_data:
                        "crop:zoomin"
                }
            ],
            [
                {
                    text:
                        "Set Profile Photo",
                    callback_data:
                        "crop:set"
                }
            ],
            [
                {
                    text: "Cancel",
                    callback_data:
                        "crop:cancel"
                }
            ]
        ]
    };
}


/* =========================
   Chat state
========================= */

const chatState =
    new Map();


function createUserState() {
    return {
        messages:
            new Set()
    };
}


function getState(chatId) {
    if (!chatState.has(chatId)) {
        chatState.set(
            chatId,
            {
                botMessages:
                    new Set(),

                users:
                    new Map(),

                crop:
                    null
            }
        );
    }

    return chatState.get(chatId);
}


function getUserState(
    chatId,
    userId
) {
    const state =
        getState(chatId);

    if (!state.users.has(userId)) {
        state.users.set(
            userId,
            createUserState()
        );
    }

    return state.users.get(
        userId
    );
}


function trackBotMessage(
    chatId,
    messageId
) {
    const state =
        getState(chatId);

    state.botMessages.add(
        messageId
    );
}


function trackUserMessage(
    chatId,
    userId,
    messageId
) {
    if (!userId) {
        return;
    }

    const userState =
        getUserState(
            chatId,
            userId
        );

    userState.messages.add(
        messageId
    );
}


/* =========================
   User interaction detection
========================= */

function messageMentionsBot(
    message
) {
    if (!message.entities) {
        return false;
    }

    const text =
        message.text || "";

    for (
        const entity
        of message.entities
    ) {
        if (
            entity.type !==
            "mention"
        ) {
            continue;
        }

        const mention =
            text.slice(
                entity.offset,
                entity.offset +
                    entity.length
            );

        if (
            mention.toLowerCase() ===
            `@${botUsername}`.toLowerCase()
        ) {
            return true;
        }
    }

    return false;
}


function repliesToBotMessage(
    message,
    chatId
) {
    const reply =
        message.reply_to_message;

    if (!reply) {
        return false;
    }

    const state =
        chatState.get(chatId);

    if (!state) {
        return false;
    }

    return state.botMessages.has(
        reply.message_id
    );
}


function isBotInteractionMessage(
    message
) {
    const chatId =
        message.chat.id;

    return (
        messageMentionsBot(
            message
        ) ||
        repliesToBotMessage(
            message,
            chatId
        )
    );
}


function trackInteractionMessage(
    message
) {
    if (!message.from) {
        return;
    }

    if (
        isBotInteractionMessage(
            message
        )
    ) {
        trackUserMessage(
            message.chat.id,
            message.from.id,
            message.message_id
        );
    }
}


/* =========================
   User mentions
========================= */

function mentionUser(user) {
    const name =
        user.username ||
        user.first_name ||
        "there";

    return (
        `<a href="tg://user?id=${user.id}">` +
        `@${escapeHtml(name)}` +
        `</a>`
    );
}


function escapeHtml(text) {
    return String(text)
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        );
}


async function sendUserMessage(
    chatId,
    user,
    text,
    replyMarkup = null
) {
    const finalText =
        user
            ? `${mentionUser(user)}, ${text}`
            : text;

    return await sendMessage(
        chatId,
        finalText,
        replyMarkup
    );
}


/* =========================
   Main menu
========================= */

async function showMainMenu(
    chatId,
    user = null
) {
    const text =
        user
            ? `${mentionUser(user)}, what would you like me to do?`
            : "What would you like me to do?";

    return await sendMessage(
        chatId,
        text,
        mainMenu()
    );
}


/* =========================
   Bot added
========================= */

async function handleNewChatMember(
    message
) {
    const newMembers =
        message.new_chat_members ||
        [];

    const wasBotAdded =
        newMembers.some(
            member =>
                member.id === botId
        );

    if (!wasBotAdded) {
        return;
    }

    const chatId =
        message.chat.id;

    getState(chatId);

    await showMainMenu(
        chatId,
        message.from || null
    );
}


/* =========================
   Normal messages
========================= */

async function handleTextMessage(
    message
) {
    trackInteractionMessage(
        message
    );
}


/* =========================
   Photo button
========================= */

async function handlePhotoAction(callback) {
    const message = callback.message;

    if (!message) {
        return;
    }

    const chatId = message.chat.id;
    const user = callback.from;
    const state = getState(chatId);

    state.cropUserId = user.id;
    state.cropUser = user;

    await answerCallback(callback.id);

    await sendUserMessage(
        chatId,
        user,
        "reply to the image you want to use with `/setphoto`.",
        photoMenu()
    );
}


/* =========================
   Crop helpers
========================= */

async function getImageMetadata(
    buffer
) {
    return await sharp(buffer)
        .metadata();
}


function clamp(
    value,
    min,
    max
) {
    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );
}


function getCropDimensions(
    width,
    height,
    zoom
) {
    const baseSize =
        Math.min(
            width,
            height
        );

    const safeZoom =
        Math.max(
            1,
            Number(zoom) || 1
        );

    const size =
        Math.max(
            1,
            Math.round(
                baseSize /
                    safeZoom
            )
        );

    return {
        width:
            Math.min(
                size,
                width
            ),

        height:
            Math.min(
                size,
                height
            )
    };
}


function updateCropBounds(
    crop
) {
    const width =
        crop.imageWidth;

    const height =
        crop.imageHeight;

    const {
        width: cropWidth,
        height: cropHeight
    } =
        getCropDimensions(
            width,
            height,
            crop.zoom
        );

    const maxLeft =
        Math.max(
            0,
            width -
                cropWidth
        );

    const maxTop =
        Math.max(
            0,
            height -
                cropHeight
        );

    crop.maxX =
        maxLeft > 0
            ? 1
            : 0;

    crop.maxY =
        maxTop > 0
            ? 1
            : 0;

    const x =
        crop.x == null
            ? 0.5
            : Number(crop.x);

    const y =
        crop.y == null
            ? 0.5
            : Number(crop.y);

    crop.x =
        clamp(
            Number.isFinite(x)
                ? x
                : 0.5,
            0,
            crop.maxX
        );

    crop.y =
        clamp(
            Number.isFinite(y)
                ? y
                : 0.5,
            0,
            crop.maxY
        );

    const panPixels =
        Math.max(
            1,
            Math.round(
                Math.min(
                    cropWidth,
                    cropHeight
                ) *
                    0.10
            )
        );

    crop.panStep =
        maxLeft > 0
            ? panPixels /
              maxLeft
            : 0;

    crop.panStepY =
        maxTop > 0
            ? panPixels /
              maxTop
            : 0;
}

function getCropPosition(
    width,
    height,
    zoom,
    x,
    y
) {
    const {
        width: cropWidth,
        height: cropHeight
    } =
        getCropDimensions(
            width,
            height,
            zoom
        );

    const maxLeft =
        Math.max(
            0,
            width -
                cropWidth
        );

    const maxTop =
        Math.max(
            0,
            height -
                cropHeight
        );

    const numericX =
        Number(x);

    const numericY =
        Number(y);

    const normalizedX =
        clamp(
            Number.isFinite(numericX)
                ? numericX
                : 0,
            0,
            1
        );

    const normalizedY =
        clamp(
            Number.isFinite(numericY)
                ? numericY
                : 0,
            0,
            1
        );

    return {
        left:
            Math.round(
                normalizedX *
                maxLeft
            ),

        top:
            Math.round(
                normalizedY *
                maxTop
            ),

        width:
            cropWidth,

        height:
            cropHeight
    };
}

async function createCrop(
    buffer,
    cropState,
    outputSize = 800
) {
    const metadata =
        await getImageMetadata(
            buffer
        );

    const width =
        metadata.width;

    const height =
        metadata.height;

    if (!width || !height) {
        throw new Error(
            "Could not determine image dimensions."
        );
    }

    /*
     * Keep the actual dimensions in the
     * crop state so pan bounds can be
     * recalculated whenever zoom changes.
     */
    cropState.imageWidth =
        width;

    cropState.imageHeight =
        height;

    updateCropBounds(
        cropState
    );

    const extract =
        getCropPosition(
            width,
            height,
            cropState.zoom,
            cropState.x,
            cropState.y
        );

    return await sharp(buffer)
        .extract(extract)
        .resize(
            outputSize,
            outputSize,
            {
                fit: "cover"
            }
        )
        .jpeg({
            quality: 90
        })
        .toBuffer();
}


function createCropState(
    imageBuffer,
    userId
) {
    return {
        imageBuffer,

        userId,

        imageWidth:
            null,

        imageHeight:
            null,

        zoom: 1,

        minZoom: 1,

        maxZoom: 5,

        zoomStep: 0.25,

        x: 0.5,

        y: 0.5,

        maxX: 1,

        maxY: 1,

        panStep: 0.05,

        panStepY: 0.05,

        previewMessageId:
            null
    };
}


function cropCaption(
    cropState
) {
    const zoom =
        Number(
            cropState.zoom
        ).toFixed(2);

    return (
        `<b>Profile Photo Preview</b>\n\n` +
        `Zoom: ${zoom}×\n\n` +
        `Use the buttons to position the image, ` +
        `then choose <b>Set Profile Photo</b>.`
    );
}


/* =========================
   Send crop preview
========================= */

async function sendCropPreview(
    chatId,
    cropState
) {
    const preview =
        await createCrop(
            cropState.imageBuffer,
            cropState,
            800
        );

    const state =
        getState(chatId);

    if (
        cropState.previewMessageId
    ) {
        const result =
            await editMessageMedia(
                chatId,
                cropState.previewMessageId,
                preview,
                cropCaption(
                    cropState
                ),
                cropMenu()
            );

        if (result.ok) {
            return result;
        }

        /*
         * The crop may have produced exactly
         * the same media/markup. This is harmless.
         */
        if (
            result.error_code === 400 &&
            result.description?.startsWith(
                "Bad Request: message is not modified:"
            )
        ) {
            return result;
        }

        console.error(
            "editMessageMedia failed:",
            result
        );

        /*
         * Genuine failure: create a new
         * preview message.
         */
    }

    const result =
        await sendPhoto(
            chatId,
            preview,
            cropCaption(
                cropState
            ),
            cropMenu()
        );

    if (result.ok) {
        cropState.previewMessageId =
            result.result.message_id;

        state.botMessages.add(
            result.result.message_id
        );
    }

    return result;
}

/* =========================
   /setphoto
========================= */

async function handleSetPhotoCommand(
    message
) {
    const chatId =
        message.chat.id;

    const referenced =
        message.reply_to_message;

    const photo =
        referenced?.photo;

    const state =
        getState(chatId);

    console.log(
        "\n=== SET PHOTO REQUEST ==="
    );

    console.log(
        "Chat:",
        chatId
    );

    console.log(
        "Chat type:",
        message.chat.type
    );

    console.log(
        "Message:",
        message.text
    );

    console.log(
        "Referenced message:",
        referenced?.message_id
    );

    console.log(
        "Photo sizes:",
        photo?.map(
            item => ({
                file_id:
                    item.file_id,
                width:
                    item.width,
                height:
                    item.height,
                file_size:
                    item.file_size
            })
        )
    );

    let user =
        message.from ||
        state.cropUser ||
        null;

    if (!photo?.length) {
        await sendUserMessage(
            chatId,
            user,
            "please reply to an image with `/setphoto`.",
            mainMenu()
        );

        return;
    }

    if (user) {
        trackUserMessage(
            chatId,
            user.id,
            message.message_id
        );
    }

    try {
        const largest =
            photo.reduce(
                (
                    largest,
                    current
                ) => {
                    const largestSize =
                        largest.file_size ||
                        0;

                    const currentSize =
                        current.file_size ||
                        0;

                    return currentSize >
                        largestSize
                        ? current
                        : largest;
                }
            );

        console.log(
            "Selected largest image:",
            {
                file_id:
                    largest.file_id,
                width:
                    largest.width,
                height:
                    largest.height,
                file_size:
                    largest.file_size
            }
        );

        console.log(
            "Downloading:",
            largest.file_id
        );

        const image =
            await downloadTelegramPhoto(
                largest.file_id
            );

        console.log(
            "Downloaded:",
            image.length,
            "bytes"
        );

        const crop =
            createCropState(
                image,
                user?.id ||
                    state.cropUserId ||
                    null
            );

        state.crop =
            crop;

        console.log(
            "Creating crop preview..."
        );

        const result =
            await sendCropPreview(
                chatId,
                crop
            );

        console.log(
            "Crop preview result:",
            JSON.stringify(
                result,
                null,
                2
            )
        );

    } catch (error) {
        console.error(
            "Crop initialization error:",
            error
        );

        await sendUserMessage(
            chatId,
            user,
            `the photo could not be prepared:\n\n${escapeHtml(error.message)}`,
            mainMenu()
        );
    }
}


/* =========================
   Crop callbacks
========================= */

async function editMessageMedia(
    chatId,
    messageId,
    fileBuffer,
    caption = "",
    replyMarkup = null
) {
    const form =
        new FormData();

    form.append(
        "chat_id",
        String(chatId)
    );

    form.append(
        "message_id",
        String(messageId)
    );

    form.append(
        "media",
        JSON.stringify({
            type: "photo",
            media:
                "attach://crop_preview",
            caption,
            parse_mode:
                "HTML"
        })
    );

    if (replyMarkup) {
        form.append(
            "reply_markup",
            JSON.stringify(
                replyMarkup
            )
        );
    }

    form.append(
        "crop_preview",
        new Blob(
            [fileBuffer],
            {
                type: "image/jpeg"
            }
        ),
        "crop_preview.jpg"
    );

    const response =
        await fetch(
            `${API}/editMessageMedia`,
            {
                method: "POST",
                body: form
            }
        );

    return await response.json();
}


async function handleCropCallback(
    callback
) {
    const message =
        callback.message;

    if (!message) {
        await answerCallback(
            callback.id
        );

        return;
    }

    const chatId =
        message.chat.id;

    const state =
        getState(chatId);

    const crop =
        state.crop;

    if (!crop) {
        await answerCallback(
            callback.id,
            "This crop session has expired."
        );

        return;
    }

    const data =
        callback.data;

    if (
        data === "crop:cancel"
    ) {
        await answerCallback(
            callback.id
        );

        state.crop = null;

        await deleteMessage(
            chatId,
            message.message_id
        );

        await showMainMenu(
            chatId,
            state.cropUser ||
                callback.from
        );

        return;
    }

    if (
        data === "crop:set"
    ) {
        await answerCallback(
            callback.id,
            "Setting profile photo..."
        );

        try {
            const cropped =
				await createCrop(
					crop.imageBuffer,
					crop
				);

            const result =
                await setChatPhoto(
                    chatId,
                    cropped
                );

            if (!result.ok) {
                throw new Error(
                    result.description ||
                    "Telegram rejected the profile photo."
                );
            }

            state.crop = null;

            await deleteMessage(
                chatId,
                message.message_id
            );

            await sendUserMessage(
                chatId,
                state.cropUser ||
                    callback.from,
                "the profile photo has been changed.",
                mainMenu()
            );

        } catch (error) {
            console.error(
                "Profile photo crop/set failed:",
                error
            );

            state.crop = null;

            await deleteMessage(
                chatId,
                message.message_id
            );

            await sendUserMessage(
                chatId,
                state.cropUser ||
                    callback.from,
                `the profile photo change failed:\n\n${escapeHtml(error.message)}`,
                mainMenu()
            );
        }

        return;
    }

        let changed = false;

    switch (data) {
        case "crop:left":
            if (
                crop.x > 0 &&
                crop.panStep > 0
            ) {
                crop.x =
                    Math.max(
                        0,
                        crop.x -
                            crop.panStep
                    );

                changed = true;
            }
            break;

        case "crop:right":
            if (
                crop.x <
                    crop.maxX &&
                crop.panStep > 0
            ) {
                crop.x =
                    Math.min(
                        crop.maxX,
                        crop.x +
                            crop.panStep
                    );

                changed = true;
            }
            break;

        case "crop:up":
            if (
                crop.y > 0 &&
                crop.panStepY > 0
            ) {
                crop.y =
                    Math.max(
                        0,
                        crop.y -
                            crop.panStepY
                    );

                changed = true;
            }
            break;

        case "crop:down":
            if (
                crop.y <
                    crop.maxY &&
                crop.panStepY > 0
            ) {
                crop.y =
                    Math.min(
                        crop.maxY,
                        crop.y +
                            crop.panStepY
                    );

                changed = true;
            }
            break;

        case "crop:zoomout":
            if (
                crop.zoom >
                crop.minZoom
            ) {
                crop.zoom =
                    Math.max(
                        crop.minZoom,
                        crop.zoom -
                            crop.zoomStep
                    );

                updateCropBounds(
                    crop
                );

                changed = true;
            }
            break;

        case "crop:zoomin":
            if (
                crop.zoom <
                crop.maxZoom
            ) {
                crop.zoom =
                    Math.min(
                        crop.maxZoom,
                        crop.zoom +
                            crop.zoomStep
                    );

                updateCropBounds(
                    crop
                );

                changed = true;
            }
            break;

        default:
            await answerCallback(
                callback.id
            );

            return;
    }

    if (!changed) {
        await answerCallback(
            callback.id
        );

        return;
    }

    try {
        const result =
            await sendCropPreview(
                chatId,
                crop
            );

        const unchanged =
            result.error_code === 400 &&
            result.description?.startsWith(
                "Bad Request: message is not modified:"
            );

        if (
            !result.ok &&
            !unchanged
        ) {
            throw new Error(
                result.description ||
                "Crop preview update failed."
            );
        }

        await answerCallback(
            callback.id
        );

    } catch (error) {
        console.error(
            "Crop preview update failed:",
            error
        );

        await answerCallback(
            callback.id,
            "Couldn't update the preview."
        );
    }
}

/* =========================
   Bye
========================= */

async function handleBye(
    callback
) {
    const message =
        callback.message;

    if (!message) {
        await answerCallback(
            callback.id,
            "Goodbye!"
        );

        return;
    }

    const chatId =
        message.chat.id;

    const user =
        callback.from;

    const state =
        getState(chatId);

    await answerCallback(
        callback.id,
        "Goodbye!"
    );

    /*
     * Delete every bot message
     * tracked for this chat.
     */
    const messagesToDelete =
        new Set(
            state.botMessages
        );

    /*
     * Delete only this user's
     * tracked interaction messages.
     */
    const userState =
        state.users.get(
            user.id
        );

    if (userState) {
        for (
            const messageId
            of userState.messages
        ) {
            messagesToDelete.add(
                messageId
            );
        }
    }

    /*
     * Crop preview is already a
     * tracked bot message, but keep
     * this explicit for safety.
     */
    if (
        state.crop?.previewMessageId
    ) {
        messagesToDelete.add(
            state.crop.previewMessageId
        );
    }

    console.log(
        "Cleaning up:",
        [...messagesToDelete]
    );

    for (
        const messageId
        of messagesToDelete
    ) {
        const result =
            await deleteMessage(
                chatId,
                messageId
            );

        console.log(
            "Delete",
            messageId,
            result
        );
    }

    chatState.delete(
        chatId
    );

    const result =
        await leaveChat(
            chatId
        );

    console.log(
        "leaveChat:",
        result
    );
}


/* =========================
   Callback handling
========================= */

async function handleCallback(
    callback
) {
    const data =
        callback.data || "";

    if (
        data.startsWith(
            "crop:"
        )
    ) {
        await handleCropCallback(
            callback
        );

        return;
    }

    if (
        data === "photo"
    ) {
        await handlePhotoAction(
            callback
        );

        return;
    }

    if (
        data === "cancel"
    ) {
        await answerCallback(
            callback.id
        );

        await showMainMenu(
            callback.message.chat.id,
            callback.from
        );

        return;
    }

    if (
        data === "bye"
    ) {
        await handleBye(
            callback
        );

        return;
    }

    await answerCallback(
        callback.id
    );
}


/* =========================
   Chat membership
========================= */

async function handleMyChatMember(
    update
) {
    const chat =
        update.chat;

    const newStatus =
        update.new_chat_member?.status;

    const oldStatus =
        update.old_chat_member?.status;

    const becameMember =
        (
            newStatus === "member" ||
            newStatus === "administrator"
        ) &&
        (
            oldStatus === "left" ||
            oldStatus === "kicked"
        );

    if (!becameMember) {
        return;
    }

    console.log(
        "Bot added to chat:",
        chat.id,
        chat.type,
        newStatus
    );

    getState(chat.id);

    await showMainMenu(
        chat.id,
        update.from || null
    );
}


/* =========================
   Command detection
========================= */

function isSetPhotoCommand(
    message
) {
    const text =
        message.text || "";

    const entities =
        message.entities || [];

    for (
        const entity
        of entities
    ) {
        if (
            entity.type !==
            "bot_command"
        ) {
            continue;
        }

        const command =
            text.slice(
                entity.offset,
                entity.offset +
                    entity.length
            );

        const normalized =
            command.toLowerCase();

        if (
            normalized ===
            "/setphoto"
        ) {
            return true;
        }

        if (
            normalized ===
            `/setphoto@${botUsername}`.toLowerCase()
        ) {
            return true;
        }
    }

    return false;
}


/* =========================
   Main
========================= */

async function main() {
    const me =
        await api("getMe");

    if (!me.ok) {
        throw new Error(
            `getMe failed: ${
                JSON.stringify(me)
            }`
        );
    }

    botId =
        me.result.id;

    botUsername =
        me.result.username;

    console.log(
        "Bot:",
        me.result
    );

    console.log(
        "Guest support:",
        me.result
            .supports_guest_queries
    );

    while (true) {
        const result =
            await api(
                "getUpdates",
                {
                    offset,
                    timeout: 30,
                    allowed_updates: [
                        "message",
                        "channel_post",
                        "callback_query",
                        "guest_message",
                        "my_chat_member"
                    ]
                }
            );

        if (!result.ok) {
            console.log(result);

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        3000
                    )
            );

            continue;
        }

        for (
            const update
            of result.result
        ) {
            offset =
                update.update_id + 1;

            console.log(
                "\nUPDATE:",
                JSON.stringify(
                    update,
                    null,
                    2
                )
            );

            if (
                update.my_chat_member
            ) {
                await handleMyChatMember(
                    update.my_chat_member
                );

                continue;
            }

            if (
                update.callback_query
            ) {
                await handleCallback(
                    update.callback_query
                );

                continue;
            }

            if (
                update.message
            ) {
                const message =
                    update.message;

                if (
                    message.new_chat_members
                ) {
                    await handleNewChatMember(
                        message
                    );

                    continue;
                }

                if (
                    isSetPhotoCommand(
                        message
                    )
                ) {
                    console.log(
                        "=== SETPHOTO COMMAND DETECTED ==="
                    );

                    await handleSetPhotoCommand(
                        message
                    );
                } else {
                    await handleTextMessage(
                        message
                    );
                }

                continue;
            }

            if (
                update.channel_post
            ) {
                const message =
                    update.channel_post;

                console.log(
                    "\n=== CHANNEL POST ==="
                );

                console.log(
                    JSON.stringify(
                        message,
                        null,
                        2
                    )
                );

                if (
                    isSetPhotoCommand(
                        message
                    )
                ) {
                    console.log(
                        "=== SETPHOTO COMMAND DETECTED ==="
                    );

                    await handleSetPhotoCommand(
                        message
                    );
                } else {
                    await handleTextMessage(
                        message
                    );
                }

                continue;
            }
        }
    }
}


main().catch(
    console.error
);
