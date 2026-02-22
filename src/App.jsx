import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
    CATEGORIES,
    EVALUATOR_META,
    DEFAULT_EVALUATION,
    PENALTY_CODES,
    PENALTY_LABELS,
    calculateCategorySum,
    calculateTotalSum,
} from './constants';
import LoginScreen from './components/LoginScreen';
import { getRoleFromMetadata } from './utils/roleUtils';
import AppHeader from './components/AppHeader';
import OverviewScreen from './components/OverviewScreen';
import EvaluationScreen from './components/EvaluationScreen';
import DirectorDetailView from './components/DirectorDetailView';
import PenaltiesModal from './components/PenaltiesModal';
import UserManagementModal from './components/UserManagementModal';
import Toast from './components/Toast';

export default function App() {
    const [user, setUser] = useState(null);
    const [role, setRole] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentYear, setCurrentYear] = useState('');
    const [candidates, setCandidates] = useState([]);
    const [evaluationsMap, setEvaluationsMap] = useState({});
    const [currentView, setCurrentView] = useState('overview');
    const [currentCandidateIndex, setCurrentCandidateIndex] = useState(0);
    const [activeModalCandidate, setActiveModalCandidate] = useState(null);
    const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
    const [toast, setToast] = useState(null);

    const isDirector = role === 'director';
    const evaluatorId = !isDirector && role ? parseInt(role.split('-')[1]) : null;

    const showToast = useCallback((message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }, []);


    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            const u = session?.user ?? null;
            console.log("Supabase Session User:", u);
            setUser(u);
            setRole(getRoleFromMetadata(u));
            setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            const u = session?.user ?? null;
            setUser(u);
            setRole(getRoleFromMetadata(u));
        });

        return () => subscription.unsubscribe();
    }, []);


    useEffect(() => {
        if (user && role) {
            const now = new Date().getFullYear();
            setCurrentYear(`${now}/${now + 1}`);
        }
    }, [user, role]);


    useEffect(() => {
        if (currentYear && user && role) {
            loadData();
        } else {
            setCandidates([]);
            setEvaluationsMap({});
        }
    }, [currentYear, user, role]);


    const loadData = async () => {

        const { data: candidatesData, error: candError } = await supabase
            .from('candidates')
            .select('id, code, school_year, created_at')
            .eq('school_year', currentYear)
            .order('code', { ascending: true });

        if (candError) {
            console.error('Error loading candidates:', candError);
            setCandidates([]);
            setEvaluationsMap({});
            return;
        }

        setCandidates(candidatesData || []);


        const candidateIds = (candidatesData || []).map(c => c.id);
        if (candidateIds.length === 0) {
            setEvaluationsMap({});
            return;
        }

        let query = supabase
            .from('evaluations')
            .select('*')
            .in('candidate_id', candidateIds);


        if (!isDirector && evaluatorId) {
            query = query.eq('evaluator_id', evaluatorId);
        }

        const { data: evalsData, error: evalError } = await query;
        if (evalError) {
            console.error('Error loading evaluations:', evalError);
            setEvaluationsMap({});
            return;
        }

        const map = {};
        (evalsData || []).forEach(e => {
            if (!map[e.candidate_id]) map[e.candidate_id] = {};
            map[e.candidate_id][e.evaluator_id] = e.evaluation;
        });

        setEvaluationsMap(map);
    };


    const handleLogin = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return error.message;
        const u = data.user;
        const userRole = getRoleFromMetadata(u);
        console.log("Login Success - User Role:", userRole);
        setUser(u);
        setRole(userRole);
        return null;
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setRole(null);
        setCurrentYear('');
        setCandidates([]);
        setEvaluationsMap({});
        setCurrentView('overview');
    };


    const handleManageCandidates = async () => {
        if (isDirector) return;
        if (!currentYear) {
            alert('Nejprve vyberte školní rok');
            return;
        }

        const currentCount = candidates.length;
        const promptText = currentCount === 0
            ? 'Zadejte počet uchazečů pro tento ročník:'
            : `Aktuální počet uchazečů: ${currentCount}\nZadejte nový počet:`;

        const countStr = prompt(promptText);
        if (!countStr) return;
        const newCount = parseInt(countStr);
        if (isNaN(newCount) || newCount < 1) {
            alert('Neplatný počet');
            return;
        }

        if (newCount > currentCount) {
            const newCandidates = Array.from({ length: newCount - currentCount }, (_, i) => ({
                code: `F${String(currentCount + i + 1).padStart(3, '0')}`,
                school_year: currentYear,
            }));

            const { error } = await supabase.from('candidates').insert(newCandidates);
            if (error) { alert('Chyba: ' + error.message); return; }
            showToast(`Přidáno ${newCount - currentCount} uchazečů`);
        } else if (newCount < currentCount) {
            if (!confirm(`Opravdu chcete smazat ${currentCount - newCount} uchazečů od konce? Tato akce je nevratná.`)) return;
            const sorted = [...candidates].sort((a, b) => (a.code || '').localeCompare(b.code || ''));
            const toDelete = sorted.slice(newCount).map(c => c.id);
            const { error } = await supabase.from('candidates').delete().in('id', toDelete);
            if (error) { alert('Chyba: ' + error.message); return; }
            showToast(`Smazáno ${currentCount - newCount} uchazečů`);
        }

        await loadData();
    };

    const moveCandidate = async (index, direction) => {
        if (isDirector) return;
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= candidates.length) return;

        const a = candidates[index];
        const b = candidates[targetIndex];
        const tempCode = `TEMP_${Date.now()}`;

        const { error: e0 } = await supabase.from('candidates').update({ code: tempCode }).eq('id', a.id);
        if (e0) { alert('Chyba při přesunu'); return; }

        const { error: e1 } = await supabase.from('candidates').update({ code: a.code }).eq('id', b.id);
        if (e1) { alert('Chyba při přesunu'); return; }

        const { error: e2 } = await supabase.from('candidates').update({ code: b.code }).eq('id', a.id);
        if (e2) { alert('Chyba při přesunu'); return; }

        await loadData();
    };


    const saveEvaluation = async (evaluation, candidateId, showAlert = true) => {
        if (isDirector || !evaluatorId) return false;

        const { error } = await supabase
            .from('evaluations')
            .upsert(
                {
                    candidate_id: candidateId,
                    evaluator_id: evaluatorId,
                    evaluation,
                },
                { onConflict: 'candidate_id,evaluator_id' }
            );

        if (error) {
            showToast('Chyba při ukládání: ' + error.message, 'error');
            return false;
        }

        setEvaluationsMap(prev => ({
            ...prev,
            [candidateId]: {
                ...(prev[candidateId] || {}),
                [evaluatorId]: evaluation,
            },
        }));

        if (showAlert) showToast('Hodnocení uloženo ✓');
        return true;
    };


    const openEvaluation = (index) => {
        setCurrentCandidateIndex(index);
        setCurrentView(isDirector ? 'director-detail' : 'evaluation');
    };

    const navigateCandidate = (direction) => {
        const newIndex = currentCandidateIndex + direction;
        if (newIndex >= 0 && newIndex < candidates.length) {
            setCurrentCandidateIndex(newIndex);
        }
    };

    const handleOpenPenalties = (candidate) => {
        setActiveModalCandidate(candidate);
    };


    const exportToExcel = () => {
        if (!currentYear || candidates.length === 0) {
            alert('Nejsou žádní uchazeči k exportu');
            return;
        }

        const wb = XLSX.utils.book_new();

        if (isDirector) {

            exportDirectorSummary(wb);
            [1, 2, 3].forEach(eid => {
                exportEvaluatorSheet(wb, eid, EVALUATOR_META[eid].name);
            });
            exportLegendSheet(wb);
        } else {
            exportEvaluatorSheet(wb, evaluatorId, EVALUATOR_META[evaluatorId].name);
            exportLegendSheet(wb);
        }

        const suffix = isDirector ? 'všichni' : EVALUATOR_META[evaluatorId].shortName;
        XLSX.writeFile(wb, `TalentWeb_${currentYear.replace('/', '-')}_${suffix}.xlsx`);
        showToast('Excel exportován ✓');
    };

    const exportDirectorSummary = (wb) => {
        const thinBorder = { style: 'thin', color: { rgb: 'B0B0B0' } };
        const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

        const ws = {};
        const merges = [];
        const setCell = (r, c, v, s) => {
            const addr = XLSX.utils.encode_cell({ r, c });
            ws[addr] = { v, t: typeof v === 'number' ? 'n' : 's' };
            if (s) ws[addr].s = s;
        };

        const headers = ['Kód', 'P-Suma', 'S-Suma', 'Z-Suma', 'Chyby Portrét', 'Chyby Soubor', 'Chyby Zátiší'];
        headers.forEach((h, i) => {
            setCell(0, i, h, {
                font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 10 },
                fill: { fgColor: { rgb: '333333' } },
                alignment: { horizontal: 'center', vertical: 'center' },
                border: borders
            });
        });

        candidates.forEach((c, rowIndex) => {
            const r = rowIndex + 1;
            const isEven = rowIndex % 2 === 0;
            const rowBg = isEven ? 'F9F9F9' : 'FFFFFF';
            const style = { border: borders, alignment: { vertical: 'center' }, fill: { fgColor: { rgb: rowBg } } };

            const evals = evaluationsMap[c.id] || {};
            const pSum = [1, 2, 3].reduce((acc, eid) => acc + calculateCategorySum(evals[eid], 'portrait'), 0);
            const fSum = [1, 2, 3].reduce((acc, eid) => acc + calculateCategorySum(evals[eid], 'file'), 0);
            const sSum = [1, 2, 3].reduce((acc, eid) => acc + calculateCategorySum(evals[eid], 'still-life'), 0);

            const getCatCodes = (catKey) => {
                const codes = new Set();
                [1, 2, 3].forEach(eid => {
                    const penalties = evals[eid]?.[catKey]?.penalties || {};
                    const cat = CATEGORIES.find(cat => cat.key === catKey);
                    Object.keys(penalties).forEach(critKey => {
                        const critIdx = cat.criteria.findIndex(cr => cr.key === critKey);
                        penalties[critKey].forEach(pKey => {
                            codes.add(`${critIdx + 1}${PENALTY_CODES[pKey] || '?'}`);
                        });
                    });
                });
                return Array.from(codes).sort().join(', ');
            };

            setCell(r, 0, c.code, { ...style, font: { bold: true }, alignment: { horizontal: 'center' } });
            setCell(r, 1, Number((pSum / 3).toFixed(2)), { ...style, alignment: { horizontal: 'center' } });
            setCell(r, 2, Number((fSum / 3).toFixed(2)), { ...style, alignment: { horizontal: 'center' } });
            setCell(r, 3, Number((sSum / 3).toFixed(2)), { ...style, alignment: { horizontal: 'center' } });
            setCell(r, 4, getCatCodes('portrait'), { ...style, font: { sz: 9 } });
            setCell(r, 5, getCatCodes('file'), { ...style, font: { sz: 9 } });
            setCell(r, 6, getCatCodes('still-life'), { ...style, font: { sz: 9 } });
        });


        const legendStartCol = 8;
        const legendHeaders = ['Kód (Legenda)', 'Význam'];
        legendHeaders.forEach((h, i) => {
            setCell(0, legendStartCol + i, h, {
                font: { bold: true, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: '333333' } },
                alignment: { horizontal: 'center', vertical: 'center' },
                border: borders
            });
        });

        let legendRow = 1;
        CATEGORIES.forEach(cat => {

            setCell(legendRow, legendStartCol, `— ${cat.title} —`, {
                font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: cat.color.replace('#', '') } },
                alignment: { horizontal: 'center' },
                border: borders
            });
            merges.push({ s: { r: legendRow, c: legendStartCol }, e: { r: legendRow, c: legendStartCol + 1 } });
            legendRow++;

            cat.criteria.forEach((crit, critIdx) => {
                crit.penalties.forEach(p => {
                    const code = `${critIdx + 1}${PENALTY_CODES[p.value] || '?'}`;
                    setCell(legendRow, legendStartCol, code, {
                        font: { bold: true, sz: 9 },
                        border: borders,
                        alignment: { horizontal: 'center', vertical: 'center' },
                        fill: { fgColor: { rgb: 'F5F5F5' } }
                    });
                    setCell(legendRow, legendStartCol + 1, `${crit.name}: ${p.label}`, {
                        border: borders,
                        alignment: { wrapText: true, vertical: 'center' },
                        font: { sz: 9 }
                    });
                    legendRow++;
                });
            });
            legendRow++;
        });

        ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(candidates.length, legendRow), c: legendStartCol + 1 });
        ws['!merges'] = merges;
        ws['!cols'] = [
            { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 25 }, { wch: 25 }, { wch: 25 },
            { wch: 5 },
            { wch: 15 }, { wch: 60 }
        ];
        XLSX.utils.book_append_sheet(wb, ws, 'Souhrn');
    };

    const exportEvaluatorSheet = (wb, eid, sheetName) => {
        const thinBorder = { style: 'thin', color: { rgb: 'B0B0B0' } };
        const borders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

        const ws = {};
        const setCell = (r, c, v, s) => {
            const addr = XLSX.utils.encode_cell({ r, c });
            ws[addr] = { v, t: typeof v === 'number' ? 'n' : 's' };
            if (s) ws[addr].s = s;
        };

        const merges = [];
        let col = 0;

        setCell(0, 0, 'Uchazeč', {
            font: { bold: true, color: { rgb: 'FFFFFF' } },
            fill: { fgColor: { rgb: '333333' } },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: borders
        });
        merges.push({ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } });
        col = 1;

        const dataCols = [];

        CATEGORIES.forEach(cat => {
            const catStart = col;
            cat.criteria.forEach(crit => {
                setCell(1, col, crit.name, {
                    font: { bold: true, sz: 8 },
                    fill: { fgColor: { rgb: 'F5F5F5' } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                    border: borders
                });
                dataCols.push({ type: 'score', catKey: cat.key, critKey: crit.key, col });
                col++;
            });

            setCell(1, col, 'Chyby', {
                font: { bold: true, sz: 9 },
                fill: { fgColor: { rgb: 'EFEFEF' } },
                alignment: { horizontal: 'center', vertical: 'center' },
                border: borders
            });
            dataCols.push({ type: 'penalties', catKey: cat.key, col });
            col++;

            setCell(1, col, 'SUMA', {
                font: { bold: true, sz: 10 },
                fill: { fgColor: { rgb: 'DEDEDE' } },
                alignment: { horizontal: 'center', vertical: 'center' },
                border: borders
            });
            dataCols.push({ type: 'suma', catKey: cat.key, col });
            col++;

            setCell(0, catStart, cat.title, {
                font: { bold: true, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: cat.color.replace('#', '') } },
                alignment: { horizontal: 'center' },
                border: borders
            });
            merges.push({ s: { r: 0, c: catStart }, e: { r: 0, c: col - 1 } });
        });

        candidates.forEach((cand, rowIndex) => {
            const r = rowIndex + 2;
            const ev = evaluationsMap[cand.id]?.[eid] || null;
            const isEven = rowIndex % 2 === 0;
            const rowBg = isEven ? 'F9F9F9' : 'FFFFFF';
            const rowStyle = { fill: { fgColor: { rgb: rowBg } }, border: borders, alignment: { vertical: 'center' } };

            setCell(r, 0, cand.code || '', { ...rowStyle, font: { bold: true }, alignment: { horizontal: 'center' } });

            dataCols.forEach(m => {
                let val = '';
                let style = { ...rowStyle, alignment: { horizontal: 'center' } };

                if (m.type === 'score') {
                    val = ev?.[m.catKey]?.[m.critKey] ?? '';
                } else if (m.type === 'suma') {
                    val = calculateCategorySum(ev, m.catKey);
                    style.font = { bold: true };
                } else if (m.type === 'penalties') {
                    const codes = [];
                    const penalties = ev?.[m.catKey]?.penalties || {};
                    const cat = CATEGORIES.find(c => c.key === m.catKey);
                    Object.keys(penalties).forEach(critKey => {
                        const critIdx = cat.criteria.findIndex(cr => cr.key === critKey);
                        penalties[critKey].forEach(pKey => {
                            codes.push(`${critIdx + 1}${PENALTY_CODES[pKey] || '?'}`);
                        });
                    });
                    val = codes.sort().join(', ');
                    style.font = { sz: 9 };
                }

                setCell(r, m.col, val, style);
            });
        });

        ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: candidates.length + 1, c: col - 1 });
        ws['!merges'] = merges;
        ws['!cols'] = [{ wch: 10 }, ...new Array(col - 1).fill({ wch: 8 })];
        ws['!rows'] = new Array(candidates.length + 2).fill({ hpt: 20 });

        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    };

    const exportLegendSheet = (wb) => {
        const headers = ['Kategorie', 'No.', 'Kód', 'Stručný popis chyby (Legenda)'];
        const rows = [];
        CATEGORIES.forEach(cat => {
            cat.criteria.forEach((crit, critIdx) => {
                const critNum = critIdx + 1;
                crit.penalties.forEach(p => {
                    const pCode = PENALTY_CODES[p.value] || '?';
                    rows.push([
                        cat.title,
                        critNum,
                        `${critNum}${pCode}`,
                        `${crit.name}: ${p.label}`
                    ]);
                });
            });
        });

        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        ws['!cols'] = [{ wch: 12 }, { wch: 5 }, { wch: 8 }, { wch: 50 }];


        const range = XLSX.utils.decode_range(ws['!ref']);
        const thinBorder = { style: 'thin', color: { rgb: 'B0B0B0' } };
        for (let r = range.s.r; r <= range.e.r; ++r) {
            for (let c = range.s.c; c <= range.e.c; ++c) {
                const addr = XLSX.utils.encode_cell({ r, c });
                if (!ws[addr]) continue;
                ws[addr].s = {
                    border: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
                    alignment: { vertical: 'center' }
                };
                if (r === 0) {
                    ws[addr].s.font = { bold: true, color: { rgb: 'FFFFFF' } };
                    ws[addr].s.fill = { fgColor: { rgb: '333333' } };
                    ws[addr].s.alignment.horizontal = 'center';
                }
            }
        }

        XLSX.utils.book_append_sheet(wb, ws, 'Legenda');
    };


    if (loading) {
        return (
            <div className="login-screen">
                <div style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
                    Načítání...
                </div>
            </div>
        );
    }

    if (!user) {
        return <LoginScreen onLogin={handleLogin} />;
    }

    if (!role) {
        return (
            <div className="login-screen">
                <div className="login-card" style={{ textAlign: 'center' }}>
                    <div className="login-logo">
                        <div className="login-logo-icon">📷</div>
                        <h1>TalentWeb</h1>
                    </div>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <p style={{ fontSize: '1.2rem', marginBottom: '0.75rem', color: 'var(--warning)' }}>⚠️ Role nebyla přiřazena</p>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>
                            Váš účet (<b>{user?.email}</b>) nemá v Supabase nastavenou roli.<br />
                        </p>

                        <div style={{ textAlign: 'left', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                            <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Diagnostika dat z Supabase:</p>
                            <pre style={{ color: '#aaa', whiteSpace: 'pre-wrap' }}>
                                {JSON.stringify({
                                    app_metadata: user?.app_metadata,
                                    user_metadata: user?.user_metadata
                                }, null, 2)}
                            </pre>
                        </div>

                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
                            Nastavte v Dashboardu roli jako:<br />
                            <code>"role": "evaluator-1"</code> (nebo 2, 3, director)
                        </p>
                    </div>
                    <button className="btn btn-secondary" onClick={handleLogout}>
                        Odhlásit se
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            <AppHeader
                currentYear={currentYear}
                onYearChange={setCurrentYear}
                onLogout={handleLogout}
                role={role}
            />
            <div className="content-wrapper">
                {currentView === 'overview' ? (
                    <OverviewScreen
                        candidates={candidates}
                        evaluationsMap={evaluationsMap}
                        role={role}
                        evaluatorId={evaluatorId}
                        isDirector={isDirector}
                        onOpenEvaluation={openEvaluation}
                        onManageCandidates={handleManageCandidates}
                        onExport={exportToExcel}
                        onOpenPenalties={handleOpenPenalties}
                        onOpenUserManagement={() => setIsUserManagementOpen(true)}
                    />
                ) : isDirector ? (
                    <DirectorDetailView
                        candidates={candidates}
                        currentIndex={currentCandidateIndex}
                        evaluationsMap={evaluationsMap}
                        onBack={() => setCurrentView('overview')}
                        onNavigate={navigateCandidate}
                    />
                ) : (
                    <EvaluationScreen
                        candidates={candidates}
                        currentIndex={currentCandidateIndex}
                        evaluationsMap={evaluationsMap}
                        evaluatorId={evaluatorId}
                        onBack={() => setCurrentView('overview')}
                        onNavigate={navigateCandidate}
                        onSave={saveEvaluation}
                    />
                )}
            </div>
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {activeModalCandidate && (
                <PenaltiesModal
                    candidate={activeModalCandidate}
                    evaluationsMap={evaluationsMap}
                    onClose={() => setActiveModalCandidate(null)}
                />
            )}

            {isUserManagementOpen && (
                <UserManagementModal
                    onClose={() => setIsUserManagementOpen(false)}
                    showToast={showToast}
                />
            )}
        </>
    );
}
