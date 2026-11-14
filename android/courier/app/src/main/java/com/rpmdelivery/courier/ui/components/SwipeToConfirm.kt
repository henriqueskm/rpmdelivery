package com.rpmdelivery.courier.ui.components

import androidx.compose.animation.core.Animatable
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** How far the thumb must travel, as a share of the track, to confirm. */
private const val CONFIRM_AT = 0.85f

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
    onConfirm: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    var trackWidth by remember { mutableIntStateOf(0) }
    val thumbSize = 56.dp
    val inset = 4.dp
    val thumbPx = with(LocalDensity.current) { (thumbSize + inset * 2).toPx() }
    val travel = (trackWidth - thumbPx).coerceAtLeast(0f)
    val shape = RoundedCornerShape(16.dp)
    val shown = if (busy) "Enviando…" else label
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(shape)
            .background(track)
            .onSizeChanged { trackWidth = it.width }
            .semantics(mergeDescendants = true) {
                role = Role.Button
                if (busy) disabled()
                onClick(label = label) { if (!busy) onConfirm(); !busy }
            }
            .draggable(
                orientation = Orientation.Horizontal,
                enabled = !busy && travel > 0f,
                state = rememberDraggableState { delta ->
                    scope.launch { offset.snapTo((offset.value + delta).coerceIn(0f, travel)) }
                },
                onDragStopped = {
                    if (travel > 0f && offset.value >= travel * CONFIRM_AT) {
                        offset.animateTo(travel)
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onConfirm()
                    }
                    // Back to the start either way: the screen moves on, or an error shows above.
                    offset.animateTo(0f)
                },
            ),
        contentAlignment = Alignment.CenterStart,
    ) {
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
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .padding(inset)
                .size(thumbSize)
                .clip(RoundedCornerShape(12.dp))
                .background(if (busy) thumb.copy(alpha = 0.5f) else thumb),
            contentAlignment = Alignment.Center,
        ) {
            Icon(painterResource(R.drawable.swipe_arrow), contentDescription = null, tint = MaterialTheme.colorScheme.surface,
                modifier = Modifier.size(24.dp))
        }
    }
}
