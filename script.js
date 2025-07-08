document.addEventListener('DOMContentLoaded', () => {

    const dom = {
        // Inputs
        betriebsmodus: document.querySelectorAll('input[name="betriebsmodus"]'),
        tempAussen: document.getElementById('tempAussen'),
        rhAussen: document.getElementById('rhAussen'),
        tempZuluft: document.getElementById('tempZuluft'),
        rhZuluft: document.getElementById('rhZuluft'),
        volumenstrom: document.getElementById('volumenstrom'),
        druck: document.getElementById('druck'),
        sollFeuchteWrapper: document.getElementById('sollFeuchteWrapper'),
        kuehlwasserWrapper: document.getElementById('kuehlwasserWrapper'),
        tempHeizVorlauf: document.getElementById('tempHeizVorlauf'),
        tempHeizRuecklauf: document.getElementById('tempHeizRuecklauf'),
        tempKuehlVorlauf: document.getElementById('tempKuehlVorlauf'),
        tempKuehlRuecklauf: document.getElementById('tempKuehlRuecklauf'),
        resetBtn: document.getElementById('resetBtn'),

        // Process Flow
        processOverviewContainer: document.getElementById('process-overview-container'),
        nodes: [document.getElementById('node-0'), document.getElementById('node-1'), document.getElementById('node-2'), document.getElementById('node-3'), document.getElementById('node-final')],
        compVE: { node: document.getElementById('comp-ve'), p: document.getElementById('res-p-ve'), wv: document.getElementById('res-wv-ve') },
        compK: { node: document.getElementById('comp-k'), p: document.getElementById('res-p-k'), wv: document.getElementById('res-wv-k'), kondensat: document.getElementById('res-kondensat') },
        compNE: { node: document.getElementById('comp-ne'), p: document.getElementById('res-p-ne'), wv: document.getElementById('res-wv-ne') },
        
        // Summary
        summaryPowerHeat: document.getElementById('summary-power-heat'),
        summaryPowerCool: document.getElementById('summary-power-cool'),
        summaryTAussen: document.getElementById('summary-t-aussen'), summaryRhAussen: document.getElementById('summary-rh-aussen'),
        summaryXAussen: document.getElementById('summary-x-aussen'), summaryXGm3Aussen: document.getElementById('summary-x-gm3-aussen'),
        summaryTZuluft: document.getElementById('summary-t-zuluft'), summaryRhZuluft: document.getElementById('summary-rh-zuluft'),
        summaryXZuluft: document.getElementById('summary-x-zuluft'), summaryXGm3Zuluft: document.getElementById('summary-x-gm3-zuluft'),
        
        summaryHAussen: document.getElementById('summary-h-aussen'), summaryHZuluft: document.getElementById('summary-h-zuluft'),
        summaryTdAussen: document.getElementById('summary-td-aussen'), summaryTdZuluft: document.getElementById('summary-td-zuluft'),
        summaryTwbAussen: document.getElementById('summary-twb-aussen'), summaryTwbZuluft: document.getElementById('summary-twb-zuluft'),
    };
    
    const allInputs = document.querySelectorAll('input');
    storeInitialValues(); 

    const TOLERANCE = 0.01; 
    const RHO_LUFT = 1.2; // kg/m³
    const CP_WASSER = 4.186; // kJ/kg·K
    const RHO_WASSER = 1000; // kg/m³

    // --- Physikalische Berechnungsfunktionen ---
    function getPs(T) { return 611.2 * Math.exp((17.62 * T) / (243.12 + T)); }
    function getX(T, rH, p) { const p_s = getPs(T); const p_v = (rH / 100) * p_s; return 622 * (p_v / (p - p_v)); }
    function getRh(T, x, p) { const p_s = getPs(T); const p_v = (p * x) / (622 + x); return Math.min(100, (p_v / p_s) * 100); }
    function getTd(x, p) { const p_v = (p * x) / (622 + x); return (243.12 * Math.log(p_v / 611.2)) / (17.62 - Math.log(p_v / 611.2)); }
    function getH(T, x_g_kg) { const x_kg_kg = x_g_kg / 1000.0; return 1.006 * T + x_kg_kg * (2501 + 1.86 * T); }

    /**
     * Berechnet die Feuchtkugeltemperatur (Twb) iterativ.
     * Die Twb ist die Temperatur, bei der die Enthalpie der Luft der Enthalpie gesättigter Luft entspricht.
     * Diese Funktion löst die implizite Gleichung h(T,x) = h(Twb, xs(Twb)) mittels Bisektionsverfahren.
     */
    function getTwb(T, x, p) {
        const h_target = getH(T, x);
        if (isNaN(h_target)) return NaN;

        let low = getTd(x, p); // Die untere Grenze für Twb ist die Taupunkttemperatur
        let high = T;         // Die obere Grenze ist die Trockenkugeltemperatur

        if (high - low < 0.01) return T; // Wenn Luft bereits gesättigt ist

        for (let i = 0; i < 15; i++) { // Bisektionsverfahren, 15 Iterationen für hohe Genauigkeit
            let mid = (low + high) / 2;
            let x_s_mid = getX(mid, 100, p);
            if (isNaN(x_s_mid)) return NaN;
            let h_mid = getH(mid, x_s_mid);

            if (h_mid < h_target) {
                low = mid;
            } else {
                high = mid;
            }
        }
        return (low + high) / 2;
    }

    function calculateAll() {
        try {
            let warningMessage = ''; 
            const modus = document.querySelector('input[name="betriebsmodus"]:checked').value;
            const inputs = {
                tempAussen: parseFloat(dom.tempAussen.value) || 0, rhAussen: parseFloat(dom.rhAussen.value) || 0,
                tempZuluft: parseFloat(dom.tempZuluft.value) || 0, rhZuluft: parseFloat(dom.rhZuluft.value) || 0,
                volumenstrom: parseFloat(dom.volumenstrom.value) || 0, druck: (parseFloat(dom.druck.value) || 1013.25) * 100,
                tempVorerhitzerSoll: 5.0,
                tempHeizVorlauf: parseFloat(dom.tempHeizVorlauf.value) || 0, tempHeizRuecklauf: parseFloat(dom.tempHeizRuecklauf.value) || 0,
                tempKuehlVorlauf: parseFloat(dom.tempKuehlVorlauf.value) || 0, tempKuehlRuecklauf: parseFloat(dom.tempKuehlRuecklauf.value) || 0,
            };

            const aussen = { t: inputs.tempAussen, rh: inputs.rhAussen };
            aussen.x = getX(aussen.t, aussen.rh, inputs.druck);
            if (!isFinite(aussen.x)) return;
            aussen.h = getH(aussen.t, aussen.x);
            aussen.x_gm3 = aussen.x * RHO_LUFT;
            aussen.td = getTd(aussen.x, inputs.druck);
            aussen.twb = getTwb(aussen.t, aussen.x, inputs.druck);

            const zuluftSoll = { t: inputs.tempZuluft };
            zuluftSoll.x = (modus === 'entfeuchten') ? getX(zuluftSoll.t, inputs.rhZuluft, inputs.druck) : aussen.x;

            if (modus === 'entfeuchten') {
                const zielTaupunkt = getTd(zuluftSoll.x, inputs.druck);
                if (zielTaupunkt < inputs.tempKuehlVorlauf + 2.0) { // Annahme: 2K Übertemperatur benötigt
                    warningMessage = `Hinweis: Kühlwasser-Temperatur (${formatGerman(inputs.tempKuehlVorlauf, 1)}°C) zu hoch, um Taupunkt von ${formatGerman(zielTaupunkt, 1)}°C zu erreichen. Entfeuchtung nicht möglich.`;
                }
            }
            
            const massenstrom_kg_s = (inputs.volumenstrom / 3600) * RHO_LUFT;
            let states = [aussen, { ...aussen }, { ...aussen }, { ...aussen }];
            let operations = { ve: { p: 0, wv: 0 }, k: { p: 0, wv: 0, kondensat: 0 }, ne: { p: 0, wv: 0 } };
            let currentState = states[0];

            if (currentState.t < inputs.tempVorerhitzerSoll) {
                const hNach = getH(inputs.tempVorerhitzerSoll, currentState.x);
                operations.ve.p = massenstrom_kg_s * (hNach - currentState.h);
                currentState = { t: inputs.tempVorerhitzerSoll, h: hNach, x: currentState.x };
            }
            states[1] = { ...currentState };

            if (modus === 'entfeuchten' || modus === 'kuehlen_sensibel') {
                const needsDehumidification = (modus === 'entfeuchten') && (currentState.x > zuluftSoll.x + TOLERANCE);
                const needsCooling = currentState.t > zuluftSoll.t + TOLERANCE;
                if (needsDehumidification) {
                    const tempNachKuehler = getTd(zuluftSoll.x, inputs.druck);
                    const hNachKuehler = getH(tempNachKuehler, zuluftSoll.x);
                    operations.k.p = massenstrom_kg_s * (currentState.h - hNachKuehler);
                    operations.k.kondensat = massenstrom_kg_s * (currentState.x - zuluftSoll.x) / 1000 * 3600;
                    currentState = { t: tempNachKuehler, h: hNachKuehler, x: zuluftSoll.x };
                } else if (needsCooling) {
                    const h_final = getH(zuluftSoll.t, currentState.x);
                    operations.k.p = massenstrom_kg_s * (currentState.h - h_final);
                    currentState = { t: zuluftSoll.t, h: h_final, x: currentState.x };
                }
            }
            states[2] = { ...currentState };

            if (currentState.t < zuluftSoll.t - TOLERANCE) {
                const h_final = getH(zuluftSoll.t, currentState.x);
                operations.ne.p = massenstrom_kg_s * (h_final - currentState.h);
                currentState = { t: zuluftSoll.t, h: h_final, x: currentState.x };
            }
            states[3] = { ...currentState };
            
            const deltaT_heiz = Math.abs(inputs.tempHeizVorlauf - inputs.tempHeizRuecklauf);
            if (deltaT_heiz > 0) {
                operations.ve.wv = (operations.ve.p / (RHO_WASSER * CP_WASSER * deltaT_heiz)) * 3600;
                operations.ne.wv = (operations.ne.p / (RHO_WASSER * CP_WASSER * deltaT_heiz)) * 3600;
            }
            const deltaT_kuehl = Math.abs(inputs.tempKuehlRuecklauf - inputs.tempKuehlVorlauf);
            if (deltaT_kuehl > 0) {
                operations.k.wv = (operations.k.p / (RHO_WASSER * CP_WASSER * deltaT_kuehl)) * 3600;
            }

            const finalState = { ...states[3] };
            finalState.rh = getRh(finalState.t, finalState.x, inputs.druck);
            finalState.x_gm3 = finalState.x * RHO_LUFT;
            finalState.h = getH(finalState.t, finalState.x);
            finalState.td = getTd(finalState.x, inputs.druck);
            finalState.twb = getTwb(finalState.t, finalState.x, inputs.druck);

            for(let i=0; i<4; i++) states[i].rh = getRh(states[i].t, states[i].x, inputs.druck);
            
            renderAll(states, operations, aussen, finalState, warningMessage);
        } catch (error) { console.error("Berechnungsfehler:", error); }
    }
    
    function renderAll(states, operations, aussen, finalState, warningMessage) {
        if (warningMessage) {
            dom.processOverviewContainer.innerHTML = `<div class="process-overview process-error">${warningMessage}</div>`;
        } else {
            const activeSteps = Object.entries(operations).filter(([, op]) => op.p > TOLERANCE);
            dom.processOverviewContainer.innerHTML = activeSteps.length > 0
                ? `<div class="process-overview process-info">Prozesskette: ${activeSteps.map(([key]) => key.toUpperCase()).join(' → ')}</div>`
                : `<div class="process-overview process-success">Idealzustand: Keine Aufbereitung notwendig</div>`;
        }

        let colors = ['color-green', '', '', '', ''];
        colors[1] = operations.ve.p > 0 ? 'color-red' : colors[0];
        colors[2] = operations.k.p > 0 ? 'color-blue' : colors[1];
        colors[3] = operations.ne.p > 0 ? 'color-red' : colors[2];
        colors[4] = finalState.t > aussen.t ? 'color-red' : (finalState.t < aussen.t ? 'color-blue' : 'color-green');

        for (let i = 0; i < 4; i++) updateStateNode(dom.nodes[i], i, states[i], colors[i], operations[Object.keys(operations)[i-1]]?.p <= 0 && i > 0 );
        updateStateNode(dom.nodes[4], 'final', finalState, colors[4]);
        
        updateComponentNode(dom.compVE, operations.ve);
        updateComponentNode(dom.compK, operations.k);
        updateComponentNode(dom.compNE, operations.ne);

        dom.summaryPowerHeat.textContent = `${formatGerman(operations.ve.p + operations.ne.p, 2)} kW`;
        dom.summaryPowerCool.textContent = `${formatGerman(operations.k.p, 2)} kW`;
        
        dom.summaryTAussen.textContent = `${formatGerman(aussen.t, 1)} °C`;
        dom.summaryRhAussen.textContent = `${formatGerman(aussen.rh, 1)} %`;
        dom.summaryXAussen.textContent = `${formatGerman(aussen.x, 2)} g/kg`;
        dom.summaryXGm3Aussen.textContent = `${formatGerman(aussen.x_gm3, 2)} g/m³`;
        dom.summaryHAussen.textContent = `${formatGerman(aussen.h, 2)} kJ/kg`;
        dom.summaryTdAussen.textContent = `${formatGerman(aussen.td, 1)} °C`;
        dom.summaryTwbAussen.textContent = `${formatGerman(aussen.twb, 1)} °C`;

        dom.summaryTZuluft.textContent = `${formatGerman(finalState.t, 1)} °C`;
        dom.summaryRhZuluft.textContent = `${formatGerman(finalState.rh, 1)} %`;
        dom.summaryXZuluft.textContent = `${formatGerman(finalState.x, 2)} g/kg`;
        dom.summaryXGm3Zuluft.textContent = `${formatGerman(finalState.x_gm3, 2)} g/m³`;
        dom.summaryHZuluft.textContent = `${formatGerman(finalState.h, 2)} kJ/kg`;
        dom.summaryTdZuluft.textContent = `${formatGerman(finalState.td, 1)} °C`;
        dom.summaryTwbZuluft.textContent = `${formatGerman(finalState.twb, 1)} °C`;
    }
    
    function updateStateNode(node, index, state, color, isInactive = false) {
        node.className = 'state-node';
        if (color) node.classList.add(color);
        if (isInactive) node.classList.add('inactive');
        if (index === 'final') node.classList.add('final-state');
        
        node.querySelector(`#res-t-${index}`).textContent = formatGerman(state.t, 1);
        node.querySelector(`#res-rh-${index}`).textContent = formatGerman(state.rh, 1);
        node.querySelector(`#res-x-${index}`).textContent = formatGerman(state.x, 2);
    }
    
    function updateComponentNode(comp, op) {
        comp.p.textContent = formatGerman(op.p, 2);
        if(comp.wv) comp.wv.textContent = formatGerman(op.wv, 2);
        if(comp.kondensat) comp.kondensat.textContent = formatGerman(op.kondensat, 2);
        comp.node.classList.toggle('inactive', op.p <= TOLERANCE);
    }
    
    function formatGerman(num, decimals = 0) { return isNaN(num) ? '--' : num.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }

    function handleBetriebsmodusChange() {
        const modus = document.querySelector('input[name="betriebsmodus"]:checked').value;
        dom.sollFeuchteWrapper.style.display = (modus === 'entfeuchten') ? 'block' : 'none';
        dom.kuehlwasserWrapper.style.display = (modus === 'heizen') ? 'none' : 'block';
        calculateAll();
    }

    function storeInitialValues() { allInputs.forEach(el => el.type === 'checkbox' || el.type === 'radio' ? el.dataset.defaultChecked = el.checked : el.dataset.defaultValue = el.value); }
    function resetToDefaults() {
        allInputs.forEach(el => el.type === 'checkbox' || el.type === 'radio' ? el.checked = el.dataset.defaultChecked === 'true' : el.value = el.dataset.defaultValue);
        handleBetriebsmodusChange();
    }

    allInputs.forEach(input => input.addEventListener('input', calculateAll));
    dom.betriebsmodus.forEach(radio => radio.addEventListener('change', handleBetriebsmodusChange));
    dom.resetBtn.addEventListener('click', resetToDefaults);

    handleBetriebsmodusChange();
});
