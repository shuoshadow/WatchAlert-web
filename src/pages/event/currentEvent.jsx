"use client"

import { useRef } from "react"
import { useState, useEffect } from "react"
import {
    Table,
    Button,
    Drawer,
    Tag,
    Select,
    Space,
    Input,
    Modal,
    Descriptions,
    Divider,
    Spin,
    Dropdown,
    message,
    Empty,
    Menu,
} from "antd"
import {getCurEventList, ProcessAlertEvent} from "../../api/event"
import TextArea from "antd/es/input/TextArea"
import { ReqAiAnalyze } from "../../api/ai"
import MarkdownRenderer from "../../utils/MarkdownRenderer"
import { AlertTriangle } from "lucide-react"
import { DownOutlined, ReloadOutlined, SearchOutlined, FilterOutlined, EllipsisOutlined } from "@ant-design/icons"
import { CreateSilenceModal } from "../silence/SilenceRuleCreateModal";
import { useLocation, useNavigate } from "react-router-dom";

export const AlertCurrentEvent = (props) => {
    const { id } = props
    const navigate = useNavigate();
    const location = useLocation();
    const { Search } = Input
    const [currentEventList, setCurrentEventList] = useState([])
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedDataSource, setSelectedDataSource] = useState("")
    const [selectedAlertLevel, setSelectedAlertLevel] = useState("")
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [selectedEvent, setSelectedEvent] = useState(null)
    const [currentPagination, setCurrentPagination] = useState({
        pageIndex: 1,
        pageSize: 10,
        pageTotal: 0,
    })
    const [loading, setLoading] = useState(true)
    const [aiAnalyze, setAiAnalyze] = useState(false)
    const [aiAnalyzeContent, setAiAnalyzeContent] = useState({})
    const [analyzeLoading, setAnalyzeLoading] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState([])
    const [batchProcessing, setBatchProcessing] = useState(false)
    // 添加一个状态来跟踪是否正在进行过滤操作
    const [isFiltering, setIsFiltering] = useState(false)
    const [selectedSilenceRow, setSelectedSilenceRow] = useState(null)
    const [silenceVisible, setSilenceVisible] = useState(false)

    // Constants
    const SEVERITY_COLORS = {
        P0: "#ff4d4f",
        P1: "#faad14",
        P2: "#b0e1fb",
    }

    const SEVERITY_LABELS = {
        P0: "P0",
        P1: "P1",
        P2: "P2",
    }

    const statusMap = {
        "pre_alert": { color: "#ffe465", text: "预告警" },
        "alerting": { color: "red", text: "告警中" },
        "silenced": { color: "grey", text: "静默中" },
        "pending_recovery": { color: "orange", text: "待恢复" },
    }

    const rowSelection = {
        selectedRowKeys,
        onChange: (selectedKeys) => {
            setSelectedRowKeys(selectedKeys)
        },
    }

    const columns = [
        {
            title: "规则名称",
            dataIndex: "rule_name",
            key: "rule_name",
            ellipsis: true,
        },
        {
            title: "告警等级",
            dataIndex: "severity",
            key: "severity",
            width: "100px",
            render: (text) => (
                <Tag
                    color={SEVERITY_COLORS[text]}
                    style={{
                        borderRadius: "12px",
                        padding: "0 10px",
                        fontSize: "12px",
                        fontWeight: "500",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                    }}
                >
                    <AlertTriangle size={12} />
                    {SEVERITY_LABELS[text] || text}
                </Tag>
            ),
        },
        {
            title: "事件详情",
            dataIndex: "annotations",
            key: "annotations",
            width: "auto",
            ellipsis: true,
            render: (text, record) => (
                <span>
                    { (record.datasource_type === "AliCloudSLS"
                        || record.datasource_type === "Loki"
                        || record.datasource_type === "ElasticSearch"
                        || record.datasource_type === "VictoriaLogs") && (
                        <span>
                            {JSON.stringify(record.log, null, 2).substring(0, 50)}...
                        </span>
                    ) || (
                        <span>
                            {record.annotations.substring(0, 50)}...
                        </span>
                    ) }
                </span>
            ),
        },
        {
            title: "初次触发时间",
            dataIndex: "first_trigger_time",
            key: "first_trigger_time",
            render: (text) => {
                const date = new Date(text * 1000)
                return date.toLocaleString()
            },
        },
        {
            title: "最近评估时间",
            dataIndex: "last_eval_time",
            key: "last_eval_time",
            render: (text) => {
                const date = new Date(text * 1000)
                return date.toLocaleString()
            },
        },
        {
            title: "认领人",
            dataIndex: "upgradeState",
            key: "upgradeState",
            render: (text) => {
                return (
                    <Tag
                        style={{
                            borderRadius: "12px",
                            padding: "0 10px",
                            fontSize: "12px",
                            fontWeight: "500",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                        }}
                    >
                        {text.whoAreConfirm || "暂无"}
                    </Tag>
                )
            },
        },
        {
            title: "事件状态",
            dataIndex: "status",
            key: "status",
            render: (text) => {
                const status = statusMap[text]
                return status ? <Tag color={status.color}>{status.text}</Tag> : "未知"
            },
        },
        {
            title: "操作",
            key: "action",
            width: "100px",
            render: (_, record) => {
                const menu = (
                    <Menu>
                        <Menu.Item onClick={() => showDrawer(record)}>
                            查看详情
                        </Menu.Item>
                        {record.status !== "silenced" && (
                            <Menu.Item onClick={() => {handleSilenceModalOpen(record)}} >
                                快捷静默
                            </Menu.Item>
                        )}
                        <Menu.Item onClick={() => openAiAnalyze(record)} disabled={analyzeLoading}>
                            {analyzeLoading ? "Ai 分析中" : "Ai 分析"}
                        </Menu.Item>
                    </Menu>
                );

                return (
                    <Dropdown overlay={menu} trigger={['click']}>
                        <EllipsisOutlined style={{ fontSize: 20, cursor: 'pointer' }} />
                    </Dropdown>
                );
            },
        },
    ]

    const [height, setHeight] = useState(window.innerHeight)

    useEffect(() => {
        // 定义一个处理窗口大小变化的函数
        const handleResize = () => {
            setHeight(window.innerHeight)
        }

        // 监听窗口的resize事件
        window.addEventListener("resize", handleResize)

        // 在组件卸载时移除监听器
        return () => {
            window.removeEventListener("resize", handleResize)
        }
    }, [])

    useEffect(() => {
        // 当过滤条件改变时，重置到第一页并获取数据
        if (isFiltering) {
            setCurrentPagination((prev) => ({
                ...prev,
                pageIndex: 1, // 重置到第一页
            }))
            handleCurrentEventList(1, currentPagination.pageSize)
            setIsFiltering(false) // 重置过滤状态
        } else {
            // 正常分页或初始加载
            handleCurrentEventList(currentPagination.pageIndex, currentPagination.pageSize)
        }
    }, [id, isFiltering, currentPagination.pageIndex, currentPagination.pageSize])

    const handleSilenceModalOpen = (record) => {
        const excludeKeys = ['value']; // 要排除的 key 列表
        const labelsArray = Object.entries(record.metric || {})
            .filter(([key]) => !excludeKeys.includes(key))
            .map(([key, value]) => ({
                key,
                operator: "=",
                value,
        }));

        const newRecord = {
            labels: labelsArray
        }

        setSelectedSilenceRow(newRecord);
        setSilenceVisible(true);
    };

    const handleSilenceModalClose = () => {
        setSilenceVisible(false);
    };


    const showDrawer = (record) => {
        setSelectedEvent(record)
        setDrawerOpen(true)
    }

    const onCloseDrawer = () => {
        setDrawerOpen(false)
    }

    const handleCurrentEventList = async (pageIndex, pageSize) => {
        try {
            setLoading(true)
            const params = {
                faultCenterId: id,
                index: pageIndex,
                size: pageSize,
                query: searchQuery || undefined,
                datasourceType: selectedDataSource || undefined,
                severity: selectedAlertLevel || undefined,
            }
            const res = await getCurEventList(params)
            if (res?.data?.list) {
                const sortedList = res.data.list.sort((a, b) => b.first_trigger_time - a.first_trigger_time)
                setCurrentEventList(sortedList)

                // 更新分页信息
                setCurrentPagination({
                    ...currentPagination,
                    pageIndex: res.data.index,
                    pageTotal: res.data.total,
                })

                // 检查是否有数据但当前页为空
                if (res.data.total > 0 && sortedList.length === 0 && pageIndex > 1) {
                    // 自动跳转到第一页
                    setCurrentPagination((prev) => ({
                        ...prev,
                        pageIndex: 1,
                    }))
                    handleCurrentEventList(1, pageSize)
                }
            }
        } catch (error) {
            message.error("获取事件列表失败: " + error.message)
        } finally {
            setLoading(false)
        }
    }

    const handleDataSourceChange = (value) => {
        setSelectedDataSource(value)
        setIsFiltering(true) // 标记正在过滤
    }

    const handleSeverityChange = (value) => {
        setSelectedAlertLevel(value)
        setIsFiltering(true) // 标记正在过滤
    }

    const handleSearch = (value) => {
        setSearchQuery(value)
        setIsFiltering(true) // 标记正在过滤
    }

    const handleShowTotal = (total, range) => `第 ${range[0]} - ${range[1]} 条 共 ${total} 条`

    const handleCurrentPageChange = (page) => {
        setCurrentPagination({ ...currentPagination, pageIndex: page.current, pageSize: page.pageSize })
    }

    const handleRefresh = () => {
        handleCurrentEventList(currentPagination.pageIndex, currentPagination.pageSize)
    }

    const handleCloseAiAnalyze = () => {
        setAiAnalyze(false)
    }

    const openAiAnalyze = async (record) => {
        setAiAnalyze(true)
        setAnalyzeLoading(true)

        // 创建 FormData 对象
        const formData = new FormData()

        let content = ""
        if (record.datasource_type === "AliCloudSLS"
            || record.datasource_type === "Loki"
            || record.datasource_type === "ElasticSearch"
            || record.datasource_type === "VictoriaLogs"){
            content = JSON.stringify(record.log, null, 2)
        } else {
            content = record.annotations
        }

        // 添加表单字段
        formData.append("rule_name", record.rule_name)
        formData.append("rule_id", record.rule_id)
        formData.append("content", content)
        formData.append("search_ql", record.searchQL)
        formData.append("deep", "false")


        const params = {
            ruleId: record.rule_id,
            ruleName: record.rule_name,
            datasourceType: record.datasource_type,
            searchQL: record.searchQL,
            fingerprint: record.fingerprint,
            annotations: content,
        }
        setAiAnalyzeContent(params)

        try {
            const res = await ReqAiAnalyze(formData)
            setAiAnalyzeContent({
                ...params,
                content: res.data,
            })
        } catch (error) {
            message.error("AI分析请求失败: " + error.message)
            setAiAnalyzeContent({
                ...params,
                content: "分析失败，请稍后重试。",
            })
        } finally {
            setAnalyzeLoading(false)
        }
    }

    const AiDeepAnalyze = async (params) => {
        let content = ""
        if (params.datasource_type === "AliCloudSLS"
            || params.datasource_type === "Loki"
            || params.datasource_type === "ElasticSearch"
            || params.datasource_type === "VictoriaLogs"){
            content = JSON.stringify(params.log, null, 2)
        } else {
            content = params.annotations
        }

        const formData = new FormData()
        formData.append("rule_name", params.ruleName)
        formData.append("rule_id", params.ruleId)
        formData.append("content", content)
        formData.append("search_ql", params.searchQL)
        formData.append("deep", "true")

        setAiAnalyzeContent({
            ...params,
            content: "",
        })

        setAnalyzeLoading(true)
        try {
            const res = await ReqAiAnalyze(formData)
            setAiAnalyzeContent({
                ...params,
                content: res.data,
            })
        } catch (error) {
            message.error("深度分析请求失败: " + error.message)
            setAiAnalyzeContent({
                ...params,
                content: "深度分析失败，请稍后重试。",
            })
        } finally {
            setAnalyzeLoading(false)
        }
    }

    const handleAiDeepAnalyze = () => {
        AiDeepAnalyze(aiAnalyzeContent)
    }

    const [percent, setPercent] = useState(-50)
    const timerRef = useRef(null)

    useEffect(() => {
        timerRef.current = setTimeout(() => {
            setPercent((v) => {
                const nextPercent = v + 5
                return nextPercent > 150 ? -50 : nextPercent
            })
        }, 100)
        return () => clearTimeout(timerRef.current)
    }, [percent])

    // 批量操作菜单
    const batchOperationMenu = {
        items: [
            {
                key: "batchClaim",
                label: "批量认领",
                onClick: () => handleBatchClaim(),
            },
            {
                key: "batchProcess",
                label: "批量处理",
                onClick: () => handleBatchProcess(),
            },
        ],
    }

    // 批量操作处理函数
    const handleBatchClaim = () => {
        setBatchProcessing(true)
        if (selectedRowKeys.length === 0) {
            message.warning("请先选择要认领的事件")
            setBatchProcessing(false)
            return
        }

        Modal.confirm({
            title: "确认批量认领",
            content: `确定要认领选中的 ${selectedRowKeys.length} 个事件吗？`,
            onOk: async () => {
                try {
                    const params = {
                        state: 1,
                        faultCenterId: id,
                        fingerprints: selectedRowKeys
                    }
                    await ProcessAlertEvent(params)
                    message.success(`成功认领 ${selectedRowKeys.length} 个事件`)
                    setSelectedRowKeys([]) // 清空选择
                    handleCurrentEventList(currentPagination.pageIndex, currentPagination.pageSize) // 刷新列表
                } catch (error) {
                    message.error("认领失败: " + error.message)
                } finally {
                    setBatchProcessing(false)
                }
            },
            onCancel: () => {
                setBatchProcessing(false)
            },
        })
    }

    const handleBatchProcess = () => {
        setBatchProcessing(true)
        if (selectedRowKeys.length === 0) {
            message.warning("请先选择要处理的事件")
            setBatchProcessing(false)
            return
        }

        Modal.confirm({
            title: "确认批量处理",
            content: `确定要处理选中的 ${selectedRowKeys.length} 个事件吗？`,
            onOk: async () => {
                try {
                    const params = {
                        state: 2,
                        faultCenterId: id,
                        fingerprints: selectedRowKeys
                    }
                    await ProcessAlertEvent(params)

                    message.success(`成功处理 ${selectedRowKeys.length} 个事件`)
                    setSelectedRowKeys([]) // 清空选择
                    handleCurrentEventList(currentPagination.pageIndex, currentPagination.pageSize) // 刷新列表
                } catch (error) {
                    message.error("处理失败: " + error.message)
                } finally {
                    setBatchProcessing(false)
                }
            },
            onCancel: () => {
                setBatchProcessing(false)
            },
        })
    }

    // 清除所有过滤条件
    const clearAllFilters = () => {
        setSearchQuery("")
        setSelectedDataSource("")
        setSelectedAlertLevel("")
        setIsFiltering(true) // 标记正在过滤
    }

    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const query = searchParams.get('query');
        if (query) {
            setSearchQuery(query);
        }
    }, [location.search]);

    const onSearchChange = (key) => {
        setSearchQuery(key);
        const searchParams = new URLSearchParams(location.search);
        searchParams.set('query', key);
        navigate(`${location.pathname}?${searchParams.toString()}`, { replace: true });
    };

    return (
        <div>
            <Modal
                centered
                open={aiAnalyze}
                onCancel={handleCloseAiAnalyze}
                width={1000}
                footer={null} // 不显示底部按钮
                styles={{
                    body: {
                        height: "700px", // 固定高度
                        overflowY: "auto", // 支持垂直滚动
                        padding: "20px",
                        backgroundColor: "#f9f9f9", // 灰色背景
                        borderRadius: "8px", // 圆角
                    },
                }}
            >
                <div style={{ marginTop: "10px" }}>
                    <Descriptions
                        items={[
                            {
                                key: "1",
                                label: "规则名称",
                                children: aiAnalyzeContent.ruleName,
                            },
                            {
                                key: "2",
                                label: "规则类型",
                                children: aiAnalyzeContent.datasourceType,
                            },
                            {
                                key: "3",
                                label: "告警指纹",
                                children: aiAnalyzeContent.fingerprint,
                            },
                        ]}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button
                            type="primary"
                            onClick={handleAiDeepAnalyze}
                            disabled={analyzeLoading}
                            style={{ background: "#000" }}
                        >
                            深度分析
                        </Button>
                    </div>
                </div>
                <Divider />
                {analyzeLoading ? (
                    <div style={{ alignItems: "center", marginTop: "100px", textAlign: "center" }}>
                        <Spin tip="Ai 分析中..." percent={percent}>
                            <br />
                        </Spin>
                    </div>
                ) : (
                    <MarkdownRenderer data={aiAnalyzeContent.content} />
                )}
            </Modal>

            <div style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Space wrap>
                        <Search
                            allowClear
                            placeholder="输入搜索关键字"
                            onSearch={handleSearch}
                            style={{ width: 200 }}
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            prefix={<SearchOutlined />}
                        />
                        <Select
                            placeholder="选择类型"
                            style={{ width: 150 }}
                            allowClear
                            value={selectedDataSource || null}
                            onChange={handleDataSourceChange}
                            options={[
                                { value: "Prometheus", label: "Prometheus" },
                                { value: "VictoriaMetrics", label: "VictoriaMetrics" },
                                { value: "AliCloudSLS", label: "AliCloudSLS" },
                                { value: "Jaeger", label: "Jaeger" },
                                { value: "Loki", label: "Loki" },
                                { value: "ElasticSearch", label: "ElasticSearch" },
                                { value: "VictoriaLogs", label: "VictoriaLogs" },
                            ]}
                        />
                        <Select
                            placeholder="选择告警等级"
                            style={{ width: 150 }}
                            allowClear
                            value={selectedAlertLevel || null}
                            onChange={handleSeverityChange}
                            options={[
                                { value: "P0", label: "P0级告警" },
                                { value: "P1", label: "P1级告警" },
                                { value: "P2", label: "P2级告警" },
                            ]}
                        />
                        <Button onClick={handleRefresh} icon={<ReloadOutlined />} loading={loading}>
                            刷新
                        </Button>
                        {(searchQuery || selectedDataSource || selectedAlertLevel) && (
                            <Button onClick={clearAllFilters} icon={<FilterOutlined />}>
                                清除筛选
                            </Button>
                        )}
                    </Space>
                    <Space>
                        <Dropdown menu={batchOperationMenu} disabled={selectedRowKeys.length === 0 || batchProcessing}>
                            <Button loading={batchProcessing}>
                                批量操作 <DownOutlined />
                            </Button>
                        </Dropdown>
                    </Space>
                </div>
            </div>

            <Table
                columns={columns}
                dataSource={currentEventList}
                loading={loading}
                rowSelection={rowSelection}
                pagination={{
                    current: currentPagination.pageIndex,
                    pageSize: currentPagination.pageSize,
                    total: currentPagination.pageTotal,
                    showTotal: handleShowTotal,
                    showSizeChanger: true,
                    pageSizeOptions: ["10", "20", "50", "100"],
                }}
                onChange={handleCurrentPageChange}
                style={{
                    backgroundColor: "#fff",
                    borderRadius: "8px",
                    overflow: "hidden",
                }}
                rowClassName={(record, index) => (index % 2 === 0 ? "bg-white" : "bg-gray-50")}
                rowKey={(record) => record.fingerprint}
                scroll={{
                    y: height - 480,
                    x: "max-content", // 水平滚动
                }}
                locale={{
                    emptyText: <Empty description="暂无告警事件" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
                }}
            />

            <CreateSilenceModal visible={silenceVisible} onClose={handleSilenceModalClose} type="create"
                                selectedRow={selectedSilenceRow} faultCenterId={id}/>

            <Drawer
                title="事件详情"
                placement="right"
                onClose={onCloseDrawer}
                open={drawerOpen}
                width={520}
                styles={{
                    body: { padding: "16px" },
                }}
            >
                {selectedEvent && (
                    <div>
                        <Descriptions
                            title="基本信息"
                            bordered
                            column={1}
                            style={{ marginBottom: "24px" }}
                            items={[
                                {
                                    key: "rule_name",
                                    label: "规则名称",
                                    children: selectedEvent.rule_name,
                                },
                                {
                                    key: "fingerprint",
                                    label: "告警指纹",
                                    children: selectedEvent.fingerprint,
                                },
                                {
                                    key: "datasource",
                                    label: "数据源",
                                    children: `${selectedEvent.datasource_type} (${selectedEvent.datasource_id})`,
                                },
                                {
                                    key: "severity",
                                    label: "告警等级",
                                    children: <Tag color={SEVERITY_COLORS[selectedEvent.severity]}>{selectedEvent.severity}</Tag>,
                                },
                                {
                                    key: "status",
                                    label: "事件状态",
                                    children: (
                                        <Tag color={statusMap[selectedEvent.status].color}>{statusMap[selectedEvent.status].text}</Tag>
                                    ),
                                },
                                {
                                    key: "value",
                                    label: "触发时值",
                                    children: selectedEvent.metric["value"] || '-',
                                },
                                {
                                    key: "confirm",
                                    label: "认领人",
                                    children: (
                                        <Tag
                                            style={{
                                                borderRadius: "12px",
                                                padding: "0 10px",
                                                fontSize: "12px",
                                                fontWeight: "500",
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: "4px",
                                            }}
                                        >
                                            {selectedEvent?.upgradeState?.whoAreConfirm || "暂无"}
                                        </Tag>
                                    ),
                                },
                            ]}
                        />

                        <div style={{ marginBottom: "16px" }}>
                            <h4>事件标签:</h4>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {Object.entries(selectedEvent.metric).map(([key, value]) => (
                                    <Tag color="processing" key={key}>{`${key}: ${value}`}</Tag>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4>事件详情:</h4>
                            { (selectedEvent.datasource_type === "AliCloudSLS"
                                || selectedEvent.datasource_type === "Loki"
                                || selectedEvent.datasource_type === "ElasticSearch"
                                || selectedEvent.datasource_type === "VictoriaLogs") && (
                                <TextArea
                                    value={JSON.stringify(selectedEvent.log, null, 2)}
                                    style={{
                                        height: 400,
                                        resize: "none",
                                        marginTop: "8px",
                                    }}
                                    readOnly
                                />
                            ) || (
                                <TextArea
                                    value={selectedEvent.annotations}
                                    style={{
                                        height: 400,
                                        resize: "none",
                                        marginTop: "8px",
                                    }}
                                    readOnly
                                />
                            ) }
                        </div>
                    </div>
                )}
            </Drawer>
        </div>
    )
}
