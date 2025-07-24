import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate, type PanInfo } from 'framer-motion';
import mqtt from 'mqtt';
import './SliderGesture.css';

// --- MQTT Settings ---
const MQTT_BROKER = "wss://broker.emqx.io:8084/mqtt";
const MQTT_TOPIC = "zotac/pico/control";

// --- Color Definitions ---
const colorNames = ["rose", "pfirsich", "creme", "mint", "himmelblau", "lavendel", "flieder"];
const keyColors = [
    [255, 191, 204], // rose
    [255, 217, 184], // pfirsich
    [255, 250, 204], // creme
    [153, 250, 153], // mint
    [135, 206, 235], // himmelblau
    [230, 230, 250], // lavendel
    [204, 159, 227]  // flieder
];

const SliderGesture: React.FC = () => {
    const [mqttClient, setMqttClient] = useState<mqtt.MqttClient | null>(null);
    const [lastMessage, setLastMessage] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [containerWidth, setContainerWidth] = useState(0);

    const constraintsRef = useRef<HTMLDivElement>(null);
    const dragStartPoint = useRef({ x: 0, y: 0 });
    
    const x = useMotionValue(0);
    const width = useMotionValue(30);

    useEffect(() => {
        if (constraintsRef.current) {
            setContainerWidth(constraintsRef.current.offsetWidth);
        }
        // Optional: Add resize listener if needed for responsive layouts
    }, []);

    // --- MQTT Connection ---
    useEffect(() => {
        try {
            console.log(`Connecting to MQTT Broker: ${MQTT_BROKER}`);
            const client = mqtt.connect(MQTT_BROKER, {
                // Empty credentials for anonymous access on some brokers
                username: '', 
                password: '',
            });

            client.on('connect', () => {
                console.log("Successfully connected to MQTT Broker!");
                setMqttClient(client);
                client.subscribe(MQTT_TOPIC, (err) => {
                    if (err) {
                        console.error("MQTT Subscribe Error:", err);
                    } else {
                        console.log(`Subscribed to topic: ${MQTT_TOPIC}`);
                    }
                });
            });

            client.on('message', (topic, payload) => {
                const message = payload.toString();
                console.log(`Received message: ${message} on topic: ${topic}`);
                setLastMessage(message);
            });

            client.on('error', (err) => {
                console.error("MQTT Connection Error: ", err);
                client.end();
            });
            
            return () => {
                if (client) {
                    console.log("Stopping MQTT Client.");
                    client.end();
                }
            };
        } catch (error) {
            console.error("Failed to connect to MQTT Broker:", error);
        }
    }, []);

    const publishMessage = useCallback((topic: string, message: string) => {
        if (mqttClient && mqttClient.connected) {
            mqttClient.publish(topic, message, (err) => {
                if (err) {
                    console.error("MQTT Publish Error:", err);
                } else {
                    console.log(`Published Geste: '${message}'`);
                }
            });
        } else {
            console.warn("MQTT client not connected. Message not sent.");
        }
    }, [mqttClient]);

    // --- UI & Color Calculations ---
    const getGradient = () => {
        const colorStops = keyColors.map((color, i) =>
            `rgb(${color.join(',')}) ${i / (keyColors.length - 1) * 100}%`
        );
        return `linear-gradient(to right, ${colorStops.join(', ')})`;
    };

    const backgroundPositionX = useTransform(x, value => -value);

    const getColorNameAt = (position: number, trackWidth: number) => {
        if (trackWidth === 0) return "";
        const colorIndex = Math.floor((position / trackWidth) * colorNames.length);
        return colorNames[Math.max(0, Math.min(colorIndex, colorNames.length - 1))];
    };

    const handlePanStart = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        x.stop();
        width.stop();

        setIsDragging(true);
        const containerRect = constraintsRef.current?.getBoundingClientRect();
        if (!containerRect) return;

        const startX = info.point.x - containerRect.left;
        const startY = info.point.y - containerRect.top;
        dragStartPoint.current = { x: startX, y: startY };
        
        x.set(startX);
        width.set(30);
    };
    
    const handlePan = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const containerRect = constraintsRef.current?.getBoundingClientRect();
        if (!containerRect || !containerWidth) return;

        const currentX = info.point.x - containerRect.left;
        const offsetX = currentX - dragStartPoint.current.x;

        let newX = x.get();
        let newWidth = width.get();

        if (offsetX > 0) { // dragging right
            newX = dragStartPoint.current.x;
            newWidth = 30 + offsetX;
        } else { // dragging left
            newX = currentX;
            newWidth = 30 + Math.abs(offsetX);
        }

        // Apply constraints
        if (newX < 0) {
            newWidth += newX; // Reduce width by the amount newX is negative
            newX = 0;
        }
        if (newX + newWidth > containerWidth) {
            newWidth = containerWidth - newX;
        }
        if (newWidth < 30) {
            newWidth = 30; // Don't allow shrinking past resting state
        }

        x.set(newX);
        width.set(newWidth);
    };

    const handlePanEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        setIsDragging(false);
        const containerRect = constraintsRef.current?.getBoundingClientRect();
        if (!containerRect || !containerWidth) return;

        // --- Animation Logic ---
        const PIXELS_PER_CM = 37.8;
        const SPEED_CM_PER_S = 1;
        const speedPxPerS = PIXELS_PER_CM * SPEED_CM_PER_S;
        
        const distanceToTravel = width.get() - 30;
        
        if (distanceToTravel < 5) { 
             width.set(30);
             const rawReleaseX = info.point.x - containerRect.left;
             const releaseX = Math.max(15, Math.min(rawReleaseX, containerWidth - 15));
             x.set(releaseX - 15);
             return; 
        }

        const duration = distanceToTravel / speedPxPerS; 
        const anim_options = { type: "tween", ease: "easeInOut", duration };

        animate(width, 30, anim_options);

        const rawReleaseX = info.point.x - containerRect.left;
        const releaseX = Math.max(15, Math.min(rawReleaseX, containerWidth - 15));

        if (info.offset.x > 0) { // Dragged right
            const finalX = releaseX - 30;
            animate(x, finalX, anim_options);
        } else { // Dragged left
            x.set(releaseX);
        }
        
        // --- MQTT Logic ---
        const dx = info.offset.x;
        const dy = info.offset.y;
        
        const minDragDistance = 50;
        let direction = "tap";
        if (Math.abs(dx) > minDragDistance || Math.abs(dy) > minDragDistance) {
            if (Math.abs(dx) > Math.abs(dy)) {
                direction = dx > 0 ? "rechts" : "links";
            } else {
                direction = dy > 0 ? "runter" : "hoch";
            }
        }
        
        const startColorName = getColorNameAt(dragStartPoint.current.x, containerRect.width);
        
        const message = `geste_${startColorName}_${direction}`;
        publishMessage(MQTT_TOPIC, message);
    };


    return (
        <>
            <motion.div 
                className="slider-container" 
                ref={constraintsRef}
                onPanStart={handlePanStart}
                onPan={handlePan}
                onPanEnd={handlePanEnd}
                whileTap={{ cursor: "grabbing" }}
            >
                <motion.div
                    className="stretchy-slider"
                    style={{
                        x,
                        width,
                        y: '-50%',
                        background: getGradient(),
                        backgroundSize: `${containerWidth}px 100%`,
                        backgroundPositionX,
                        backgroundRepeat: 'no-repeat',
                    }}
                />
            </motion.div>
            <div className="mqtt-status">
                Last Message: {lastMessage || "None"}
            </div>
        </>
    );
};

export default SliderGesture;
