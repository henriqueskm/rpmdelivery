package com.rpmdelivery.courier.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import kotlinx.coroutines.delay
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rpmdelivery.courier.R
import kotlin.math.roundToInt

/**
 * How far the thumb must travel, as a share of the track, to confirm. 0.85 made couriers drag to the
 * phone's edge (first real-phone test); 0.6 still needs a deliberate swipe.
 */
private const val CONFIRM_AT = 0.6f
/** A quick flick confirms from here on: the finger often leaves the glass before the end. */
private const val FLING_FROM = 0.35f

/**
 * Actions that cannot be undone (start the route, delivered, back at the store) confirm with a swipe
 * to the end of the track: a tap, a slip or a glove brushing the screen does nothing. Letting go early
 * returns the thumb. Screen readers cannot swipe, so the same action is offered as the control's
 * click action, which TalkBack runs with a deliberate double tap.
 */
@Composable
fun SwipeToConfirm(
    label: String,
    busy: Boolean,
    track: Color,
    thumb: Color,
    text: Color,
    /** What the track says while the server answers, e.g. "Registrando chegada…". */
    busyLabel: String = "Enviando…",
    onConfirm: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val density = LocalDensity.current
    // The thumb's position, set synchronously on every drag delta so it stays under the finger.
    // (Launching a coroutine per delta lost movement: each snapTo could cancel the one before.)
    var offset by remember { mutableFloatStateOf(0f) }
    var trackWidth by remember { mutableIntStateOf(0) }
    // Confirmed: the thumb stays at the end with a ✓ until the answer comes, so the swipe never looks ignored.
    var confirmed by remember { mutableStateOf(false) }
    val thumbSize = 56.dp
    val inset = 4.dp
    val thumbPx = with(LocalDensity.current) { (thumbSize + inset * 2).toPx() }
    val travel = (trackWidth - thumbPx).coerceAtLeast(0f)
    val flingPx = with(density) { 900.dp.toPx() } // per second
    val shape = RoundedCornerShape(16.dp)
    // After a refusal ("longe da loja"), the thumb slides back to the start.
    var returning by remember { mutableStateOf(false) }
    // Past the point that confirms: say so, and tick once, so the courier knows to let go.
    val armed = travel > 0f && offset >= travel * CONFIRM_AT
    LaunchedEffect(armed) { if (armed && !confirmed) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick) }
    val shown = when { returning -> label; busy || confirmed -> busyLabel; armed -> "Solte para confirmar"; else -> label }
    suspend fun settle(target: Float) {
        animate(offset, target, animationSpec = spring(stiffness = Spring.StiffnessMediumLow)) { value, _ -> offset = value }
    }
    // The command ran (or was refused) and this control is still on screen: back to the start.
    // The short wait lets "busy" arrive first; an answer that moves the screen on never shows the return.
    // Slide back first, then clear "confirmed": clearing it restarts this effect, which cancelled the
    // slide and left the thumb stuck at the end after every refusal (it then confirmed again on a touch).
    LaunchedEffect(confirmed, busy) {
        if (confirmed && !busy) {
            delay(400)
            returning = true
            try { settle(0f) } finally { returning = false }
            confirmed = false
        }
    }
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(shape)
            .background(track)
            .onSizeChanged { trackWidth = it.width }
            .semantics(mergeDescendants = true) {
                role = Role.Button
                if (busy || confirmed) disabled()
                onClick(label = label) { val ready = !busy && !confirmed; if (ready) onConfirm(); ready }
            }
            .draggable(
                orientation = Orientation.Horizontal,
                enabled = !busy && !confirmed && travel > 0f,
                state = rememberDraggableState { delta -> offset = (offset + delta).coerceIn(0f, travel) },
                onDragStopped = { velocity ->
                    val reached = offset >= travel * CONFIRM_AT || (velocity > flingPx && offset >= travel * FLING_FROM)
                    if (travel > 0f && reached) {
                        settle(travel)
                        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                        confirmed = true
                        onConfirm()
                    } else settle(0f)
                },
            ),
        contentAlignment = Alignment.CenterStart,
    ) {
        // The part already swiped fills with the thumb's color: progress you can see at a glance.
        Box(
            Modifier
                .padding(vertical = inset)
                .width(with(density) { (offset + thumbPx).toDp() })
                .heightIn(min = thumbSize)
                .clip(shape)
                .background(thumb.copy(alpha = 0.18f)),
        )
        Text(
            shown,
            color = text,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(start = thumbSize + inset * 3, end = 16.dp, top = 8.dp, bottom = 8.dp),
        )
        Box(
            Modifier
                .offset { IntOffset(offset.roundToInt(), 0) }
                .padding(inset)
                .size(thumbSize)
                .clip(RoundedCornerShape(12.dp))
                .background(if (busy && !confirmed) thumb.copy(alpha = 0.5f) else thumb),
            contentAlignment = Alignment.Center,
        ) {
            if (confirmed) Text("✓", color = MaterialTheme.colorScheme.surface, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            else Icon(painterResource(R.drawable.swipe_arrow), contentDescription = null, tint = MaterialTheme.colorScheme.surface,
                modifier = Modifier.size(24.dp))
        }
    }
}
